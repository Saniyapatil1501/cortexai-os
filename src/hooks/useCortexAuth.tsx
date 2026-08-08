import React, { createContext, useContext, useEffect, useState } from "react";
import { useUser, useAuth } from "@clerk/clerk-react";
import { cortexClient } from "@/lib/api";

export interface CortexUser {
  user_id: number;
  email: string;
  clerk_id?: string;
  first_name?: string;
  last_name?: string;
  profile_image_url?: string;
}

interface CortexAuthContextType {
  user: CortexUser | null;
  isLoading: boolean;
  isBackendOffline: boolean;
  getToken: () => Promise<string | null>;
  isClerkLoaded: boolean;
  isSignedIn: boolean;
  retrySync: () => void;
}

const CortexAuthContext = createContext<CortexAuthContextType | undefined>(undefined);

export function CortexAuthProvider({ children }: { children: React.ReactNode }) {
  const { isLoaded: isClerkLoaded, isSignedIn, user: clerkUser } = useUser();
  const { getToken } = useAuth();

  const [user, setUser] = useState<CortexUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBackendOffline, setIsBackendOffline] = useState(false);
  const [syncTrigger, setSyncTrigger] = useState(0);

  // Setup api token getter on load
  useEffect(() => {
    cortexClient.setTokenGetter(getToken);
  }, [getToken]);

  const retrySync = () => {
    console.log("[CortexAuth] retrySync triggered. Resetting states and incrementing trigger.");
    setIsBackendOffline(false);
    setIsLoading(true);
    setSyncTrigger((prev) => prev + 1);
  };

  useEffect(() => {
    console.log(
      "[CortexAuth] useEffect triggered. isClerkLoaded:",
      isClerkLoaded,
      "isSignedIn:",
      isSignedIn,
      "userObject:",
      clerkUser ? "Present" : "Missing",
      "syncTrigger:",
      syncTrigger,
    );
    if (!isClerkLoaded) {
      console.log("[CortexAuth] Clerk is still loading. Returning.");
      return;
    }

    const syncUserSession = async () => {
      if (!isSignedIn || !clerkUser) {
        console.log("[CortexAuth] Clerk loaded but user is NOT signed in. Resetting user to null.");
        setUser(null);
        setIsLoading(false);
        return;
      }

      try {
        console.log(
          "[CortexAuth] Clerk loaded and user is signed in. Setting isLoading=true and fetching JWT token...",
        );
        setIsLoading(true);
        const token = await getToken();
        console.log(
          "[CortexAuth] getToken result:",
          token ? "Token retrieved successfully" : "No token returned",
        );

        console.log("[CortexAuth] Dispatching sync request to backend database...");
        // Sync user details to backend
        const syncResult = await cortexClient.syncUser({
          clerk_id: clerkUser.id,
          email: clerkUser.primaryEmailAddress?.emailAddress || "",
          first_name: clerkUser.firstName || undefined,
          last_name: clerkUser.lastName || undefined,
          profile_image_url: clerkUser.imageUrl || undefined,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
        });
        console.log(
          "[CortexAuth] Backend database sync completed. Response status:",
          syncResult ? "Success" : "Failed",
        );

        if (syncResult && syncResult.user_id) {
          console.log("[CortexAuth] Sync user success. user_id:", syncResult.user_id);
          setUser({
            user_id: syncResult.user_id,
            email: syncResult.email,
            clerk_id: syncResult.clerk_id,
            first_name: syncResult.first_name,
            last_name: syncResult.last_name,
            profile_image_url: syncResult.profile_image_url,
          });
          setIsBackendOffline(false);
        } else {
          throw new Error("Invalid sync response");
        }
      } catch (err) {
        console.error("[CortexAuth] Cortex auth sync error:", err);
        setIsBackendOffline(true);
        setUser(null);
      } finally {
        console.log("[CortexAuth] Setting isLoading=false.");
        setIsLoading(false);
      }
    };

    syncUserSession();
  }, [isClerkLoaded, isSignedIn, clerkUser, syncTrigger, getToken]);

  return (
    <CortexAuthContext.Provider
      value={{
        user,
        isLoading,
        isBackendOffline,
        getToken,
        isClerkLoaded,
        isSignedIn: !!isSignedIn,
        retrySync,
      }}
    >
      {children}
    </CortexAuthContext.Provider>
  );
}

export function useCortexAuth() {
  const context = useContext(CortexAuthContext);
  if (context === undefined) {
    throw new Error("useCortexAuth must be used within a CortexAuthProvider");
  }
  return context;
}
