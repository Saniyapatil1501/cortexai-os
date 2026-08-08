import { ReactNode, useState, useEffect } from "react";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Sparkles,
  Timer,
  BarChart3,
  Bell,
  Settings,
  Search,
  Menu,
  X,
  Command,
  Minus,
  Square,
  BookOpen,
} from "lucide-react";
import { Command as Cmdk } from "cmdk";
import { Logo } from "./Logo";
import { AmbientBackground } from "./AmbientBackground";
import { AssistantOrb } from "./AssistantOrb";
import { cortexClient } from "@/lib/api";
import { useCortexAuth } from "@/hooks/useCortexAuth";
import { UserButton } from "@clerk/clerk-react";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/assistant", label: "AI Assistant", icon: Sparkles },
  { to: "/materials", label: "Study Materials", icon: BookOpen },
  { to: "/focus", label: "Focus", icon: Timer },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/reminders", label: "Reminders", icon: Bell },
  { to: "/settings", label: "Settings", icon: Settings },
];

let remindersInterval: any = null;
const lastTriggeredMap: Record<number, number> = {};

function triggerNotification(title: string, body: string) {
  if ((window as any).cortexAPI?.sendNotification) {
    (window as any).cortexAPI.sendNotification(title, body);
  } else if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body });
  } else {
    console.log(`[Reminder Notification] ${title}: ${body}`);
  }
}

function startRemindersLoop(userId: number) {
  if (remindersInterval) {
    clearInterval(remindersInterval);
  }

  const checkReminders = async () => {
    try {
      const reminders = await cortexClient.getReminders(userId);
      const now = new Date();
      const nowMs = now.getTime();

      for (const rem of reminders) {
        if (!rem.is_enabled) continue;

        const intervalStr = rem.recurrence_interval.toLowerCase().trim();
        if (intervalStr === "session_start") {
          continue;
        }

        const durationMatch = intervalStr.match(
          /every\s+(\d+)\s*(m|min|minute|minutes|h|hr|hour|hours)?/,
        );
        if (durationMatch) {
          let mins = parseInt(durationMatch[1], 10);
          const unit = durationMatch[2] || "m";
          if (unit.startsWith("h")) {
            mins *= 60;
          }
          const intervalMs = mins * 60 * 1000;

          if (lastTriggeredMap[rem.id] === undefined) {
            lastTriggeredMap[rem.id] = nowMs;
            continue;
          }

          const elapsedMs = nowMs - lastTriggeredMap[rem.id];
          if (elapsedMs >= intervalMs) {
            triggerNotification(rem.title, rem.description || "Time for a quick break!");
            lastTriggeredMap[rem.id] = nowMs;
          }
        } else {
          const timeMatch = intervalStr.match(/at\s+(\d+):(\d+)\s*(am|pm)?/);
          if (timeMatch) {
            let hours = parseInt(timeMatch[1], 10);
            const minutes = parseInt(timeMatch[2], 10);
            const ampm = timeMatch[3];
            if (ampm === "pm" && hours < 12) hours += 12;
            if (ampm === "am" && hours === 12) hours = 0;

            const targetTimeStr = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
            const currentTimeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

            if (currentTimeStr === targetTimeStr && !lastTriggeredMap[rem.id]) {
              triggerNotification(rem.title, rem.description || "Scheduled reminder alert");
              lastTriggeredMap[rem.id] = nowMs;
            } else if (currentTimeStr !== targetTimeStr) {
              if (lastTriggeredMap[rem.id]) {
                const elapsedSinceLastTrigger = nowMs - lastTriggeredMap[rem.id];
                if (elapsedSinceLastTrigger > 60 * 1000) {
                  delete lastTriggeredMap[rem.id];
                }
              }
            }
          }
        }
      }
    } catch (e) {
      console.error("Error checking reminders in background loop:", e);
    }
  };

  checkReminders();
  remindersInterval = setInterval(checkReminders, 30000);
}

export function AppLayout({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();

  const {
    user,
    isLoading: isAuthLoading,
    isBackendOffline,
    isSignedIn,
    isClerkLoaded,
  } = useCortexAuth();

  // Theme state
  const [theme, setTheme] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("cortex-theme") || "matte_black";
    }
    return "matte_black";
  });

  // Search/Command palette state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Guard redirects
  useEffect(() => {
    console.log(
      "[CortexAuth] AppLayout guard check. path:",
      path,
      "isClerkLoaded:",
      isClerkLoaded,
      "isAuthLoading:",
      isAuthLoading,
      "isSignedIn:",
      isSignedIn,
      "hasUser:",
      user ? "Yes" : "No",
    );
    if (isClerkLoaded && !isAuthLoading) {
      if (!isSignedIn) {
        console.log(
          "[CortexAuth] Guard check failed: User is not signed in to Clerk. Redirecting to /login...",
        );
        navigate({ to: "/login" });
      } else if (!user && isBackendOffline) {
        console.log(
          "[CortexAuth] Guard check: Clerk signed in but backend is offline. Let user stay.",
        );
      }
    }
  }, [isClerkLoaded, isAuthLoading, isSignedIn, user, isBackendOffline, navigate, path]);

  // Request notifications permission
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // Fetch settings theme
  useEffect(() => {
    if (user?.user_id) {
      cortexClient
        .getUserSettings(user.user_id)
        .then((settings) => {
          if (settings && settings.theme) {
            setTheme(settings.theme);
            localStorage.setItem("cortex-theme", settings.theme);
          }
        })
        .catch(console.error);
    }
  }, [user?.user_id]);

  // Apply theme classes to root
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("theme-graphite", "theme-soft_white");
    if (theme === "graphite") {
      root.classList.add("theme-graphite");
    } else if (theme === "soft_white") {
      root.classList.add("theme-soft_white");
    }
    localStorage.setItem("cortex-theme", theme);
  }, [theme]);

  // Listen for live theme modifications
  useEffect(() => {
    const handleThemeChange = (e: Event) => {
      const newTheme = (e as CustomEvent).detail;
      if (newTheme) {
        setTheme(newTheme);
      }
    };
    window.addEventListener("cortex:theme-change", handleThemeChange);
    return () => {
      window.removeEventListener("cortex:theme-change", handleThemeChange);
    };
  }, []);

  // Cmd+K palette key listener
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  // Reminders loop trigger
  useEffect(() => {
    if (user?.user_id) {
      startRemindersLoop(user.user_id);
    }
    return () => {
      if (remindersInterval) {
        clearInterval(remindersInterval);
      }
    };
  }, [user?.user_id]);

  if (isAuthLoading || (isSignedIn && !user && !isBackendOffline)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-foreground mx-auto" />
          <p className="mt-4 text-sm text-muted-foreground">Syncing workspace session...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <AmbientBackground density={50} className="fixed inset-0 z-0 opacity-60" />

      <div className="relative z-10 flex min-h-screen">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex w-[240px] shrink-0 flex-col border-r border-border bg-sidebar/80 backdrop-blur-xl">
          <SidebarInner path={path} />
        </aside>

        {/* Mobile sidebar */}
        <AnimatePresence>
          {mobileOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
                onClick={() => setMobileOpen(false)}
              />
              <motion.aside
                initial={{ x: -280 }}
                animate={{ x: 0 }}
                exit={{ x: -280 }}
                transition={{ type: "spring", damping: 28, stiffness: 260 }}
                className="fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col border-r border-border bg-sidebar lg:hidden"
              >
                <SidebarInner path={path} onNavigate={() => setMobileOpen(false)} />
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar */}
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/70 px-4 backdrop-blur-xl md:px-6 drag-region">
            <button
              onClick={() => setMobileOpen(true)}
              className="grid h-9 w-9 place-items-center rounded-md border border-border text-muted-foreground hover:text-foreground lg:hidden no-drag-region cursor-pointer"
              aria-label="Open menu"
            >
              <Menu className="h-4 w-4" />
            </button>

            <div
              onClick={() => setSearchOpen(true)}
              className="hidden md:flex items-center gap-2 rounded-md border border-border bg-surface-1/60 px-3 py-1.5 w-[360px] max-w-full no-drag-region cursor-pointer hover:bg-surface-2/40 transition"
            >
              <Search className="h-4 w-4 text-muted-foreground" />
              <div className="flex-1 text-sm text-muted-foreground select-none text-left">
                Search anything or ask Cortex…
              </div>
              <kbd className="hidden md:inline-flex items-center gap-1 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                <Command className="h-3 w-3" /> K
              </kbd>
            </div>

            <div className="flex-1" />

            {isBackendOffline && (
              <div className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5 no-drag-region">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400/40" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
                </span>
                <span className="text-xs text-amber-400 font-medium">Daemon Offline</span>
              </div>
            )}

            {!isBackendOffline && (
              <div className="hidden sm:flex items-center gap-2 rounded-md border border-border bg-surface-1/60 px-2.5 py-1.5 no-drag-region">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/40" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                <span className="text-xs text-muted-foreground">Cortex online</span>
              </div>
            )}

            <button className="grid h-9 w-9 place-items-center rounded-md border border-border text-muted-foreground hover:text-foreground no-drag-region cursor-pointer">
              <Bell className="h-4 w-4" />
            </button>

            {/* Clerk User Button */}
            <div className="flex items-center gap-2 no-drag-region">
              <UserButton afterSignOutUrl="/login" />
            </div>

            {/* Electron Custom Window Controls */}
            {typeof window !== "undefined" && (window as any).cortexAPI && (
              <div className="flex items-center gap-1 border-l border-border pl-2.5 ml-1 no-drag-region">
                <button
                  onClick={() => (window as any).cortexAPI.minimizeWindow()}
                  className="h-8 w-8 rounded-md hover:bg-surface-2 grid place-items-center text-muted-foreground hover:text-foreground transition cursor-pointer"
                  title="Minimize"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <button
                  onClick={() => (window as any).cortexAPI.maximizeWindow()}
                  className="h-8 w-8 rounded-md hover:bg-surface-2 grid place-items-center text-muted-foreground hover:text-foreground transition cursor-pointer"
                  title="Maximize"
                >
                  <Square className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => (window as any).cortexAPI.closeWindow()}
                  className="h-8 w-8 rounded-md hover:bg-red-500/25 grid place-items-center text-muted-foreground hover:text-red-400 transition cursor-pointer"
                  title="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </header>

          <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
        </div>
      </div>
      <AssistantOrb />

      {/* Cmd+K Command Palette Modal */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm pt-[15vh] p-4"
          onClick={() => setSearchOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-lg border border-border bg-surface-1/95 shadow-2xl overflow-hidden p-2 no-drag-region"
            onClick={(e) => e.stopPropagation()}
          >
            <Cmdk className="w-full">
              <div className="flex items-center border-b border-border px-3 py-2.5">
                <Search className="h-4 w-4 mr-2.5 text-muted-foreground" />
                <Cmdk.Input
                  autoFocus
                  value={searchQuery}
                  onValueChange={setSearchQuery}
                  placeholder="Search anything or ask Cortex (Press Enter)..."
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground text-foreground"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && searchQuery.trim()) {
                      sessionStorage.setItem("cortex_auto_prompt", searchQuery);
                      setSearchOpen(false);
                      setSearchQuery("");
                      navigate({ to: "/assistant" });
                    }
                  }}
                />
                <button
                  onClick={() => setSearchOpen(false)}
                  className="text-[10px] bg-surface-2 px-1.5 py-0.5 rounded text-muted-foreground border border-border cursor-pointer"
                >
                  ESC
                </button>
              </div>
              <Cmdk.List className="max-h-[300px] overflow-y-auto p-1.5 space-y-1">
                <Cmdk.Empty className="text-xs text-muted-foreground p-3 text-center">
                  No results found.
                </Cmdk.Empty>

                <Cmdk.Group
                  heading="Navigation"
                  className="text-[10px] font-semibold text-muted-foreground px-2.5 py-1 uppercase tracking-wider"
                >
                  <Cmdk.Item
                    onSelect={() => {
                      navigate({ to: "/dashboard" });
                      setSearchOpen(false);
                    }}
                    className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground hover:bg-surface-2 cursor-pointer transition"
                  >
                    <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
                    <span>Dashboard</span>
                  </Cmdk.Item>
                  <Cmdk.Item
                    onSelect={() => {
                      navigate({ to: "/assistant" });
                      setSearchOpen(false);
                    }}
                    className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground hover:bg-surface-2 cursor-pointer transition"
                  >
                    <Sparkles className="h-4 w-4 text-muted-foreground" />
                    <span>AI Assistant</span>
                  </Cmdk.Item>
                  <Cmdk.Item
                    onSelect={() => {
                      navigate({ to: "/focus" });
                      setSearchOpen(false);
                    }}
                    className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground hover:bg-surface-2 cursor-pointer transition"
                  >
                    <Timer className="h-4 w-4 text-muted-foreground" />
                    <span>Focus Timer</span>
                  </Cmdk.Item>
                  <Cmdk.Item
                    onSelect={() => {
                      navigate({ to: "/analytics" });
                      setSearchOpen(false);
                    }}
                    className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground hover:bg-surface-2 cursor-pointer transition"
                  >
                    <BarChart3 className="h-4 w-4 text-muted-foreground" />
                    <span>Analytics Insights</span>
                  </Cmdk.Item>
                  <Cmdk.Item
                    onSelect={() => {
                      navigate({ to: "/materials" });
                      setSearchOpen(false);
                    }}
                    className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground hover:bg-surface-2 cursor-pointer transition"
                  >
                    <BookOpen className="h-4 w-4 text-muted-foreground" />
                    <span>Study Materials</span>
                  </Cmdk.Item>
                  <Cmdk.Item
                    onSelect={() => {
                      navigate({ to: "/reminders" });
                      setSearchOpen(false);
                    }}
                    className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground hover:bg-surface-2 cursor-pointer transition"
                  >
                    <Bell className="h-4 w-4 text-muted-foreground" />
                    <span>Reminders</span>
                  </Cmdk.Item>
                  <Cmdk.Item
                    onSelect={() => {
                      navigate({ to: "/settings" });
                      setSearchOpen(false);
                    }}
                    className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground hover:bg-surface-2 cursor-pointer transition"
                  >
                    <Settings className="h-4 w-4 text-muted-foreground" />
                    <span>Settings</span>
                  </Cmdk.Item>
                </Cmdk.Group>
              </Cmdk.List>
            </Cmdk>
          </div>
        </div>
      )}
    </div>
  );
}

function SidebarInner({ path, onNavigate }: { path: string; onNavigate?: () => void }) {
  return (
    <>
      <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-5">
        <Logo showWord />
        {onNavigate && (
          <button onClick={onNavigate} className="text-muted-foreground lg:hidden cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {nav.map((item) => {
          const active = path === item.to || (item.to !== "/" && path.startsWith(item.to));
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={`group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="sidebar-active"
                  className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-foreground"
                  transition={{ type: "spring", damping: 30, stiffness: 300 }}
                />
              )}
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
