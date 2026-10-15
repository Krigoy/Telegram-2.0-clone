'use server';

import { auth } from "@clerk/nextjs/server";
import { serverClient } from "@/lib/streamServer";

/**
 * Issues a Stream token for the currently signed-in Clerk user.
 *
 * The user ID is read from the Clerk session on the server, never from the
 * client. Accepting a user ID as an argument would let any caller mint a token
 * for someone else's account and read their conversations.
 */
export async function createToken() {
    const { userId } = await auth();

    if (!userId) {
        throw new Error("Not authenticated");
    }

    return serverClient.createToken(userId);
}
