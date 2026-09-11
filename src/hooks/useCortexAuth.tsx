import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useUser, useAuth } from "@clerk/clerk-react";
import { cortexClient } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";

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
  daemonStatus: "starting" | "connecting" | "online" | "offline" | "reconnecting";
  getToken: () => Promise<string | null>;
  isClerkLoaded: boolean;
  isSignedIn: boolean;
  retrySync: () => void;
  sessionState: "booting" | "unauthenticated" | "authenticating" | "authenticated" | "session_expired" | "signing_out";
  
  // Centralized Focus/Activity state and controls
  activeSession: any | null;
  running: boolean;
  elapsed: number;
  distractions: { tabSwitch: number; appSwap: number; idle: number };
  activeState: string;
  activeApp: string;
  activeTitle: string;
  activeCategory: string;
  activeReason: string;
  timelineEvents: any[];
  summary: any;
  chartData: any[];
  apps: any[];
  recentSessions: any[];
  
  startFocusSession: (intention: string, targetDurationSeconds?: number, focusType?: string) => Promise<any>;
  endFocusSession: (completed?: boolean, elapsedSeconds?: number, status?: string) => Promise<any>;
  pauseFocusSession: () => Promise<any>;
  resumeFocusSession: () => Promise<any>;
  updateFocusSession: (data: { intention?: string; targetDurationSeconds?: number }) => Promise<any>;
  resetFocusSession: () => void;
  fetchActivityStats: () => void;
}

const CortexAuthContext = createContext<CortexAuthContextType | undefined>(undefined);

export function CortexAuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { isLoaded: isClerkLoaded, isSignedIn: isClerkSignedIn, user: clerkUser } = useUser();
  const { getToken: getClerkToken } = useAuth();

  const [user, setUser] = useState<CortexUser | null>(null);
  const [sessionState, setSessionState] = useState<"booting" | "unauthenticated" | "authenticating" | "authenticated" | "session_expired" | "signing_out">("booting");
  const [isLoading, setIsLoading] = useState(true);
  const [daemonStatus, setDaemonStatus] = useState<"starting" | "connecting" | "online" | "offline" | "reconnecting">("starting");
  const isBackendOffline = daemonStatus === "offline";
  const [syncTrigger, setSyncTrigger] = useState(0);

  const isSignedIn = !!isClerkSignedIn;

  // Phase 2 Centralized Focus/Activity States
  const [activeSession, setActiveSession] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [distractions, setDistractions] = useState({ tabSwitch: 0, appSwap: 0, idle: 0 });
  const [activeState, setActiveState] = useState<string>("UNKNOWN");
  const [activeApp, setActiveApp] = useState<string>("System");
  const [activeTitle, setActiveTitle] = useState<string>("Desktop Idle");
  const [activeCategory, setActiveCategory] = useState<string>("unknown");
  const [activeReason, setActiveReason] = useState<string>("Continuous updates");
  const [timelineEvents, setTimelineEvents] = useState<any[]>([]);

  // Statistics states (for Dashboard alignment)
  const [summary, setSummary] = useState<any>(null);
  const [chartData, setChartData] = useState<any[]>([]);
  const [apps, setApps] = useState<any[]>([]);
  const [recentSessions, setRecentSessions] = useState<any[]>([]);

  const getToken = async () => {
    return getClerkToken();
  };

  // Setup api token getter on load
  useEffect(() => {
    cortexClient.setTokenGetter(getToken);
  }, [getClerkToken]);

  const retrySync = () => {
    console.log("[CortexAuth] retrySync triggered. Resetting states and incrementing trigger.");
    setDaemonStatus("reconnecting");
    setIsLoading(true);
    setSyncTrigger((prev) => prev + 1);
  };

  // Listen for session expiration events from API client
  useEffect(() => {
    const handleExpired = () => {
      console.warn("[CortexAuth] Session expiration event received. Transitioning to session_expired.");
      setSessionState("session_expired");
      setUser(null);
    };
    window.addEventListener("cortex:session-expired", handleExpired);
    return () => window.removeEventListener("cortex:session-expired", handleExpired);
  }, []);

  const fetchActivityStats = useCallback(() => {
    const targetUserId = user?.user_id;
    if (!targetUserId || targetUserId === -1) return;

    cortexClient
      .getActivitySummary(targetUserId)
      .then((sum) => {
        setSummary(sum);
      })
      .catch(console.error);

    cortexClient
      .getProductivityAnalytics(targetUserId)
      .then((data) => {
        setChartData(data || []);
      })
      .catch(console.error);

    cortexClient
      .getActiveApps(targetUserId)
      .then((data) => {
        setApps(data || []);
      })
      .catch(console.error);

    cortexClient
      .getRecentFocusSessions(targetUserId)
      .then((data) => {
        setRecentSessions(data.slice(0, 5) || []);
      })
      .catch(console.error);
  }, [user?.user_id]);

  const startFocusSession = async (intention: string, targetDurationSeconds = 25 * 60, focusType = "study") => {
    const targetUserId = user?.user_id;
    if (!targetUserId || targetUserId === -1) {
      throw new Error("No authenticated user");
    }

    try {
      const sess = await cortexClient.startFocusSession(targetUserId, intention, targetDurationSeconds, focusType);
      setActiveSession(sess);
      setRunning(true);
      setElapsed(0);
      setDistractions({ tabSwitch: 0, appSwap: 0, idle: 0 });
      setTimelineEvents([]);
      setActiveState("STUDY");
      fetchActivityStats();
      return sess;
    } catch (err) {
      console.error("[CortexAuth] Failed to start focus session:", err);
      throw err;
    }
  };

  const endFocusSession = async (completed = false, elapsedSeconds = 0, status?: string) => {
    if (!activeSession) return null;

    const sessionId = activeSession.id;
    setRunning(false);
    setActiveState("SESSION_ENDED");
    setActiveSession(null);
    setElapsed(0);

    try {
      const analytics = await cortexClient.endFocusSession(sessionId, completed, distractions.tabSwitch, status);
      fetchActivityStats();
      return analytics;
    } catch (err) {
      console.error("[CortexAuth] Failed to end focus session:", err);
      throw err;
    }
  };

  const pauseFocusSession = async () => {
    if (!activeSession) return null;
    try {
      const sess = await cortexClient.pauseFocusSession(activeSession.id);
      setActiveSession(sess);
      setRunning(false);
      return sess;
    } catch (err) {
      console.error("[CortexAuth] Failed to pause focus session:", err);
      throw err;
    }
  };

  const resumeFocusSession = async () => {
    if (!activeSession) return null;
    try {
      const sess = await cortexClient.resumeFocusSession(activeSession.id);
      setActiveSession(sess);
      setRunning(true);
      return sess;
    } catch (err) {
      console.error("[CortexAuth] Failed to resume focus session:", err);
      throw err;
    }
  };

  const resetFocusSession = () => {
    if (activeSession) {
      endFocusSession(false, elapsed, "cancelled").catch(console.error);
    } else {
      setElapsed(0);
    }
  };

  const updateFocusSession = async (data: { intention?: string; targetDurationSeconds?: number }) => {
    if (!activeSession) return null;
    try {
      const sess = await cortexClient.updateFocusSession(activeSession.id, data);
      setActiveSession(sess);
      return sess;
    } catch (err) {
      console.error("[CortexAuth] Failed to update focus session:", err);
      throw err;
    }
  };

  // Manage authenticating/authenticated lifecycle and sync
  useEffect(() => {
    if (!isClerkLoaded) {
      setSessionState("booting");
      setIsLoading(true);
      return;
    }

    const runSync = async () => {
      if (!isClerkSignedIn || !clerkUser) {
        console.log("[CortexAuth] Clerk loaded. No active session. Resetting to unauthenticated.");
        
        if (user || sessionState === "authenticated" || sessionState === "signing_out") {
          try {
            await cortexClient.logout();
          } catch (err) {
            console.error("[CortexAuth] Backend logout request failed:", err);
          }
        }
        
        queryClient.clear();
        setUser(null);
        setSessionState("unauthenticated");
        setIsLoading(false);
        return;
      }

      if (
        sessionState === "authenticated" &&
        user &&
        user.clerk_id === clerkUser.id &&
        (user.user_id !== -1 || daemonStatus === "offline")
      ) {
        setIsLoading(false);
        return;
      }

      console.log("[CortexAuth] Beginning backend user synchronization...");
      setSessionState("authenticating");
      setIsLoading(true);

      try {
        const token = await getClerkToken();
        if (!token) {
          throw new Error("No token returned by Clerk");
        }

        const syncResult = await cortexClient.syncUser({
          clerk_id: clerkUser.id,
          email: clerkUser.primaryEmailAddress?.emailAddress || "",
          first_name: clerkUser.firstName || undefined,
          last_name: clerkUser.lastName || undefined,
          profile_image_url: clerkUser.imageUrl || undefined,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
        });

        if (syncResult && syncResult.user_id) {
          console.log("[CortexAuth] User synchronized successfully with backend user ID:", syncResult.user_id);
          queryClient.clear();
          setUser({
            user_id: syncResult.user_id,
            email: syncResult.email,
            clerk_id: syncResult.clerk_id,
            first_name: syncResult.first_name,
            last_name: syncResult.last_name,
            profile_image_url: syncResult.profile_image_url,
          });
          setSessionState("authenticated");
        } else {
          throw new Error("Sync response missing user ID");
        }
      } catch (err: any) {
        console.error("[CortexAuth] User synchronization failed:", err);
        
        const isAuthError = err.message?.includes("401") || err.message?.includes("expired") || err.message?.includes("signature");
        
        if (isAuthError) {
          setSessionState("session_expired");
          setUser(null);
        } else if (daemonStatus === "offline" || err.message?.includes("Failed to fetch")) {
          console.log("[CortexAuth] Backend offline. Entering offline authenticated fallback.");
          queryClient.clear();
          setUser({
            user_id: -1,
            email: clerkUser.primaryEmailAddress?.emailAddress || "offline@cortex.ai",
            clerk_id: clerkUser.id,
            first_name: clerkUser.firstName || "Offline User",
            last_name: clerkUser.lastName || "",
            profile_image_url: clerkUser.imageUrl || undefined,
          });
          setSessionState("authenticated");
        } else {
          setSessionState("unauthenticated");
          setUser(null);
        }
      } finally {
        setIsLoading(false);
      }
    };

    runSync();
  }, [isClerkLoaded, isClerkSignedIn, clerkUser, syncTrigger, getClerkToken, queryClient, daemonStatus]);

  // Load initial stats and restore active session state on user change
  useEffect(() => {
    const targetUserId = user?.user_id;
    if (!targetUserId || targetUserId === -1) {
      setActiveSession(null);
      setRunning(false);
      setElapsed(0);
      setDistractions({ tabSwitch: 0, appSwap: 0, idle: 0 });
      setActiveState("UNKNOWN");
      setActiveApp("System");
      setActiveTitle("Desktop Idle");
      setActiveCategory("unknown");
      setActiveReason("Continuous updates");
      setTimelineEvents([]);
      setSummary(null);
      setChartData([]);
      setApps([]);
      setRecentSessions([]);
      return;
    }

    fetchActivityStats();

    cortexClient.getActiveFocusSession(targetUserId).then((sess) => {
      if (sess) {
        setActiveSession(sess);
        setRunning(true);
        setElapsed(sess.duration_seconds || 0);
        setDistractions({
          tabSwitch: sess.distraction_count || 0,
          appSwap: sess.app_swaps || 0,
          idle: sess.idle_count || 0,
        });

        if (sess.id) {
          cortexClient
            .getSessionTimeline(sess.id)
            .then((evts) => {
              setTimelineEvents(evts);
              if (evts && evts.length > 0) {
                const last = evts[evts.length - 1];
                setActiveState(last.state);
                setActiveApp(last.app_name || "System");
                setActiveTitle(last.window_title || "Study Session");
                setActiveCategory(last.classification || "unknown");
                setActiveReason(last.classification_reason || "Continuous updates");
              }
            })
            .catch(console.error);
        }
      } else {
        setActiveSession(null);
        setRunning(false);
        setElapsed(0);
      }
    }).catch(console.error);
  }, [user?.user_id, fetchActivityStats]);

  // Local 1-second clock to make the timer tick smoothly in the UI
  useEffect(() => {
    if (!running || (activeSession && activeSession.status === "paused")) return;

    const interval = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [running, activeSession?.status]);

  // Polling loop to keep local states perfectly synced with backend daemon state
  useEffect(() => {
    const targetUserId = user?.user_id;
    if (!activeSession || !targetUserId || targetUserId === -1) return;

    const pollInterval = setInterval(() => {
      cortexClient.getActiveFocusSession(targetUserId).then((sess) => {
        if (sess) {
          setElapsed(sess.duration_seconds || 0);
          setActiveSession(sess);
          setRunning(sess.status === "running");
          setDistractions({
            tabSwitch: sess.distraction_count || 0,
            appSwap: sess.app_swaps || 0,
            idle: sess.idle_count || 0,
          });

          if (sess.id) {
            cortexClient
              .getSessionTimeline(sess.id)
              .then((evts) => {
                setTimelineEvents(evts);
                if (evts && evts.length > 0) {
                  const last = evts[evts.length - 1];
                  setActiveState(last.state);
                  setActiveApp(last.app_name || "System");
                  setActiveTitle(last.window_title || "Study Session");
                  setActiveCategory(last.classification || "unknown");
                  setActiveReason(last.classification_reason || "Continuous updates");
                }
              })
              .catch(console.error);
          }

          const totalTarget = sess.target_duration_seconds || 25 * 60;
          if (sess.duration_seconds >= totalTarget && sess.status === "running") {
            clearInterval(pollInterval);
            endFocusSession(true, sess.duration_seconds, "completed").catch(console.error);
          }
        } else {
          setRunning(false);
          setActiveSession(null);
          setElapsed(0);
          fetchActivityStats();
        }
      }).catch(console.error);
    }, 5000);

    return () => clearInterval(pollInterval);
  }, [activeSession?.id, user?.user_id, fetchActivityStats]);

  // Polling loop to get current active window telemetry when NOT in a focus session
  useEffect(() => {
    const targetUserId = user?.user_id;
    if (!targetUserId || targetUserId === -1) return;

    const pollCurrent = () => {
      // Only poll current active window if NO active focus session is running
      if (activeSession) return;

      cortexClient.getCurrentActivity().then((curr) => {
        if (curr) {
          setActiveApp(curr.app_name || "System");
          setActiveTitle(curr.window_title || "Active Workspace");
          
          const cat = curr.category || "unknown";
          setActiveCategory(cat);
          setActiveState(cat.toUpperCase());
          setActiveReason(curr.reason || "Continuous updates");
        }
      }).catch(console.error);
    };

    pollCurrent();
    const interval = setInterval(pollCurrent, 4000);
    return () => clearInterval(interval);
  }, [user?.user_id, activeSession?.id]);

  // Polling loop to refresh activity stats periodically (every 10 seconds)
  useEffect(() => {
    const targetUserId = user?.user_id;
    if (!targetUserId || targetUserId === -1) return;

    const interval = setInterval(fetchActivityStats, 10000);
    return () => clearInterval(interval);
  }, [user?.user_id, fetchActivityStats]);

  // Standalone, unauthenticated health check to detect if FastAPI is online
  useEffect(() => {
    let active = true;

    const checkHealth = async () => {
      try {
        const response = await fetch("http://127.0.0.1:8000/", {
          method: "GET",
          headers: { "Accept": "application/json" },
          mode: "cors",
        });
        if (response.ok) {
          const data = await response.json();
          if (data.status === "online" && data.service === "CortexAI Desktop Daemon") {
            if (active) {
              setDaemonStatus("online");
            }
            return;
          }
        }
        throw new Error("Invalid health response");
      } catch (err) {
        if (active) {
          setDaemonStatus("offline");
        }
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 5000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [syncTrigger]);

  return (
    <CortexAuthContext.Provider
      value={{
        user,
        isLoading,
        isBackendOffline,
        daemonStatus,
        getToken,
        isClerkLoaded,
        isSignedIn,
        retrySync,
        sessionState,
        
        // Centralized States
        activeSession,
        running,
        elapsed,
        distractions,
        activeState,
        activeApp,
        activeTitle,
        activeCategory,
        activeReason,
        timelineEvents,
        summary,
        chartData,
        apps,
        recentSessions,
        
        startFocusSession,
        endFocusSession,
        pauseFocusSession,
        resumeFocusSession,
        updateFocusSession,
        resetFocusSession,
        fetchActivityStats,
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
