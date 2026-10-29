import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

//Get user byClerk UserId
export const getUserByClerkId = query({
    args: { userId: v.string()},
    handler: async (ctx, { userId }) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) return null;

        if(!userId) return null;

        return await ctx.db    
            .query("users")
            .withIndex("by_userId", (q) => q.eq("userId", userId))
            .first();
    },
});

//Create or update user (sync from clerk)
export const upsertUser = mutation({
    args: {
        userId: v.string(),
        name: v.string(),
        email: v.string(),
        imageUrl: v.string(),
    },
    handler: async (ctx, {userId, name, email, imageUrl }) => {
        // Only a signed-in user may create or update their own record.
        const identity = await ctx.auth.getUserIdentity();
        if (!identity || identity.subject !== userId) {
            throw new Error("Not authorized to update this user");
        }

        const existingUser = await ctx.db
            .query("users")
            .withIndex("by_userId", (q) => q.eq("userId", userId))
            .first();

        if(existingUser) {
            await ctx.db.patch(existingUser._id, { name, email, imageUrl });
            return existingUser._id;
        }

        return await ctx.db.insert("users", { userId, name, email, imageUrl });
    },
});

//Search users by name or email
export const searchUsers = query({
    args: { searchTerm: v.string() },
    handler: async (ctx, { searchTerm }) => {
        // The user directory (names and emails) is only visible to signed-in users.
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) return [];

        if(!searchTerm.trim()) return [];

        const normalizedSearch = searchTerm.toLowerCase().trim();

        //Get all users and filter them by name or email containing search term
        const allUsers = await ctx.db.query("users").collect();

        return allUsers
            .filter(
                (user) =>
                    user.name.toLowerCase().includes(normalizedSearch) || 
                    user.email.toLowerCase().includes(normalizedSearch)
            )
            .slice(0, 20);
    },
});