import streamClient from "@/lib/stream";

// Stream channel IDs (also reused as video call IDs) allow at most 64
// characters from [a-zA-Z0-9_-].
const MAX_CHANNEL_ID_LENGTH = 64;

// cyrb53: small deterministic string hash (53-bit), returned as base36.
const cyrb53 = (str: string, seed = 0) => {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
};

// Same two members always produce the same ID, regardless of who starts the
// chat, so concurrent "Start Chat" clicks end up on one channel.
const getDirectChannelId = (members: string[]) => {
    const [a, b] = [...members].sort();
    const readableId = `dm-${a}-${b}`.replace(/[^a-zA-Z0-9_-]/g, "");

    if (readableId.length <= MAX_CHANNEL_ID_LENGTH) {
        return readableId;
    }

    // Too long (e.g. two Clerk IDs): hash with two seeds to keep collisions negligible
    const key = `${a}|${b}`;
    return `dm-${cyrb53(key)}${cyrb53(key, 1)}`;
};

export const useCreateNewChat = () => {
    const createNewChat = async ({
        members,
        createdBy,
        groupName,
    }: {
        members: string[];
        createdBy: string;
        groupName?: string;
    }) => {
        const isGroupChat = members.length > 2;

        //Only check for existing chats for 1-1 chats
        if (!isGroupChat) {
            const existingChannel = await streamClient.queryChannels(
                {
                    type: "messaging",
                    members: { $eq:members },
                },
                { created_at: -1 },
                { limit: 1 }
            );

            if(existingChannel.length > 0) {
                const channel = existingChannel[0];
                const channelMembers = Object.keys(channel.state.members);

                //For 1-1 Chats, ensure exactly the same 2 members
                if (
                    channelMembers.length === 2 &&
                    members.length === 2 &&
                    members.every((member) => channelMembers.includes(member))
                ) {
                    console.log("Existing 1-1 chat found");
                    return channel;
                }
            }
        }

        //1-1 chats get a deterministic ID so concurrent creates converge on one channel;
        //group chats are always new
        const channelId = isGroupChat
            ? `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
            : getDirectChannelId(members);

        try {
            //Create channel with appropriate configuration for group vs 1-1 chat
            const channelData: {
                members: string[];
                created_by_id: string;
                name?: string;
            } = {
                members,
                created_by_id: createdBy,
            };

            //for group chats, add group-specific metedata
            if (isGroupChat) {
                channelData.name =
                    groupName || `Group chat(${members.length} members)`;
            }

            const channel = streamClient.channel(
                "messaging",
                channelId,
                channelData
            );

            //watch() creates the channel, or returns it if it already exists
            await channel.watch({
                presence: true
            });

            return channel;
        } catch (error) {
            throw error;
        }
    };

    return createNewChat;
};
