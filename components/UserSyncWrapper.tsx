"use client";

import { api } from "@/convex/_generated/api";
import { useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation } from "convex/react";
import { RefObject, useEffect, useRef, useState } from "react";
import { LoadingSpinner } from "./LoadingSpinner";
import streamClient from "@/lib/stream";
import { createToken } from "@/actions/createToken";

const CONVEX_AUTH_ERROR =
  'Could not authenticate with Convex. Check that your Clerk JWT template is named "convex" and that CLERK_JWT_ISSUER_DOMAIN is set in your Convex deployment.';

//Run Stream connect/disconnect one after another so they never overlap
function enqueue(
  queueRef: RefObject<Promise<void>>,
  task: () => Promise<void>
): Promise<void> {
  const run = queueRef.current.then(task);
  queueRef.current = run.catch(() => {});
  return run;
}

function disconnectStream(queueRef: RefObject<Promise<void>>) {
  enqueue(queueRef, async () => {
    if (!streamClient.userID) return;
    await streamClient.disconnectUser();
  }).catch((err) => console.error("Failed to disconnect user:", err));
}

function UserSyncWrapper({ children }: { children: React.ReactNode }) {
  const { user, isLoaded: isUserLoaded } = useUser();
  // Wait until Convex has the Clerk token, so the upsert mutation is authenticated.
  const { isLoading: isConvexAuthLoading, isAuthenticated: isConvexAuthed } =
    useConvexAuth();
  // ID of the user whose data has been synced and who is connected to Stream
  const [syncedUserId, setSyncedUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  //Convex mutation to sync user
  const createOrUpdateUser = useMutation(api.users.upsertUser);

  const userId = user?.id;

  // Clerk returns a new user object on every update; keep the latest one in a
  // ref so the sync effect only re-runs when the user ID changes.
  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const streamQueueRef = useRef<Promise<void>>(Promise.resolve());

  //Sync user to Convex and connect to Stream once per signed-in user
  useEffect(() => {
    if (!isUserLoaded || !userId) return;
    if (isConvexAuthLoading || !isConvexAuthed) return;

    let cancelled = false;

    const syncUser = async () => {
      const currentUser = userRef.current;
      if (!currentUser || currentUser.id !== userId) return;

      const email = currentUser.primaryEmailAddress?.emailAddress ?? "";
      const name =
        currentUser.fullName || currentUser.firstName || email || "Unknown User";

      try {
        setError(null);

        //1. Save User to convex
        await createOrUpdateUser({
          userId,
          name,
          email,
          imageUrl: currentUser.imageUrl || "",
        });

        //2.Connect user to stream (after any pending disconnect finishes)
        await enqueue(streamQueueRef, async () => {
          if (cancelled || streamClient.userID === userId) return;

          if (streamClient.userID) {
            await streamClient.disconnectUser();
          }

          await streamClient.connectUser(
            {
              id: userId,
              name,
              image: currentUser.imageUrl || "",
            },
            async () => await createToken()
          );
        });

        if (!cancelled && streamClient.userID === userId) {
          setSyncedUserId(userId);
        }
      } catch (err) {
        console.error("Failed to sync user:", err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to sync user");
        }
      }
    };

    syncUser();

    return () => {
      cancelled = true;
    };
  }, [
    isUserLoaded,
    userId,
    isConvexAuthLoading,
    isConvexAuthed,
    createOrUpdateUser,
  ]);

  //Disconnect from Stream when the user signs out
  useEffect(() => {
    if (!isUserLoaded || userId) return;

    setSyncedUserId(null);
    disconnectStream(streamQueueRef);
  }, [isUserLoaded, userId]);

  //Disconnect from Stream on unmount
  useEffect(() => {
    return () => disconnectStream(streamQueueRef);
  }, []);

  // Convex finished loading auth but rejected the Clerk token
  const convexAuthFailed =
    isUserLoaded && !!userId && !isConvexAuthLoading && !isConvexAuthed;
  const displayError = convexAuthFailed ? CONVEX_AUTH_ERROR : error;

  if (displayError) {
    return (
      <div className="flex flex-1 flex-col min-h-screen items-center justify-center bg-white px-6">
        <p className="text-red-500 text-lg font-semibold mb-2">Sync Error</p>
        <p className="text-gray-600 text-center mb-4">{displayError}</p>
        <p className="text-gray-500 text-sm text-center">
          Please try restarting the app or contact support if the issue
          persists.
        </p>
      </div>
    );
  }

  //Loading state
  if (!isUserLoaded || (userId && syncedUserId !== userId)) {
    return (
      <LoadingSpinner
        size="lg"
        message={!isUserLoaded ? "Loading..." : "Syncing user data..."}
        className="min-h-screen"
      />
    );
  }

  return <>{children}</>;
}

export default UserSyncWrapper;
