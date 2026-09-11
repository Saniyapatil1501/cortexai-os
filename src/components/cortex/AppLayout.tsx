import { ReactNode, useState, useEffect, useRef } from "react";
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
  Trash2,
  Send,
  Camera,
  Paperclip,
  Mic,
} from "lucide-react";
import { Command as Cmdk } from "cmdk";
import { Logo } from "./Logo";
import { WindowControls } from "./WindowControls";
import { AmbientBackground } from "./AmbientBackground";
import { AssistantOrb } from "./AssistantOrb";
import { cortexClient } from "@/lib/api";
import { toast } from "sonner";
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
  const [companionOpen, setCompanionOpen] = useState(false);
  const [isCompanionEnabled, setIsCompanionEnabled] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("cortex:enable-companion") !== "false";
    }
    return true;
  });

  useEffect(() => {
    const handleEvent = (e: Event) => {
      const val = (e as CustomEvent).detail;
      setIsCompanionEnabled(val);
    };
    window.addEventListener("cortex:companion-enabled-change", handleEvent);
    return () => {
      window.removeEventListener("cortex:companion-enabled-change", handleEvent);
    };
  }, []);

  const {
    user,
    isLoading: isAuthLoading,
    isBackendOffline,
    daemonStatus,
    isSignedIn,
    isClerkLoaded,
    sessionState,
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
      "sessionState:",
      sessionState,
      "hasUser:",
      user ? "Yes" : "No",
    );
    if (sessionState === "unauthenticated" || sessionState === "session_expired") {
      console.log(
        `[CortexAuth] Guard check failed: sessionState is "${sessionState}". Redirecting to /login...`,
      );
      navigate({ to: "/login" });
    }
  }, [sessionState, navigate, path, user]);

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

  if (sessionState === "booting") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-foreground mx-auto" />
          <p className="mt-4 text-sm text-muted-foreground">Starting CortexAI...</p>
        </div>
      </div>
    );
  }

  if (sessionState === "authenticating") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-foreground mx-auto" />
          <p className="mt-4 text-sm text-muted-foreground">Syncing workspace session...</p>
        </div>
      </div>
    );
  }

  if (sessionState === "signing_out") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-foreground mx-auto" />
          <p className="mt-4 text-sm text-muted-foreground">Signing out...</p>
        </div>
      </div>
    );
  }

  if (sessionState === "unauthenticated" || sessionState === "session_expired") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-foreground mx-auto" />
          <p className="mt-4 text-sm text-muted-foreground">Redirecting to login...</p>
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
          <SidebarInner path={path} onOpenCompanion={() => setCompanionOpen(true)} />
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
                <SidebarInner
                  path={path}
                  onNavigate={() => setMobileOpen(false)}
                  onOpenCompanion={() => {
                    setMobileOpen(false);
                    setCompanionOpen(true);
                  }}
                />
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        <div className={`flex min-w-0 flex-1 flex-col transition-all duration-300 ${companionOpen ? "mr-[380px]" : "mr-0"}`}>
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

            {daemonStatus === "starting" && (
              <div className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5 no-drag-region">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400/40" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
                </span>
                <span className="text-xs text-amber-400 font-medium">Starting...</span>
              </div>
            )}

            {daemonStatus === "connecting" && (
              <div className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5 no-drag-region">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400/40" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
                </span>
                <span className="text-xs text-amber-400 font-medium">Connecting...</span>
              </div>
            )}

            {daemonStatus === "reconnecting" && (
              <div className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5 no-drag-region">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400/40" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
                </span>
                <span className="text-xs text-amber-400 font-medium">Reconnecting...</span>
              </div>
            )}

            {daemonStatus === "offline" && (
              <div className="flex items-center gap-2 rounded-md border border-red-500/20 bg-red-500/5 px-2.5 py-1.5 no-drag-region">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400/40" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-red-400" />
                </span>
                <span className="text-xs text-red-400 font-medium">Daemon Offline</span>
              </div>
            )}

            {daemonStatus === "online" && (
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
            <WindowControls className="border-l border-border pl-2.5 ml-1" />
          </header>

          <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
        </div>
      </div>
      {isCompanionEnabled && (
        <AssistantOrb isOpen={companionOpen} onToggle={() => setCompanionOpen(!companionOpen)} />
      )}

      <AnimatePresence>
        {companionOpen && (
          <motion.aside
            initial={{ x: 380, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 380, opacity: 0 }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed inset-y-0 right-0 z-40 w-[380px] flex flex-col border-l border-border bg-sidebar/95 backdrop-blur-xl shadow-2xl"
          >
            <CompanionDrawer onClose={() => setCompanionOpen(false)} />
          </motion.aside>
        )}
      </AnimatePresence>

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
                      setSearchOpen(false);
                      const q = searchQuery;
                      setSearchQuery("");
                      setCompanionOpen(true);
                      setTimeout(() => {
                        window.dispatchEvent(new CustomEvent("cortex:open-companion-query", { detail: q }));
                      }, 100);
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
                      setSearchOpen(false);
                      setCompanionOpen(true);
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

function SidebarInner({
  path,
  onNavigate,
  onOpenCompanion,
}: {
  path: string;
  onNavigate?: () => void;
  onOpenCompanion?: () => void;
}) {
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
              onClick={(e) => {
                if (item.to === "/assistant") {
                  e.preventDefault();
                  onOpenCompanion?.();
                } else {
                  onNavigate?.();
                }
              }}
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

function renderMessageText(text: string) {
  if (!text) return null;
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("```") && part.endsWith("```")) {
      const content = part.substring(3, part.length - 3).trim();
      const firstNewline = content.indexOf("\n");
      let lang = "";
      let code = content;
      if (firstNewline !== -1) {
        lang = content.substring(0, firstNewline).trim();
        code = content.substring(firstNewline + 1);
      }
      return (
        <div key={idx} className="my-3 overflow-hidden rounded-md border border-border bg-surface-3/80 font-mono text-[11px] select-text">
          <div className="flex items-center justify-between bg-surface-2 px-3 py-1.5 text-[9px] text-muted-foreground select-none">
            <span>{lang.toUpperCase() || "CODE"}</span>
            <button
              onClick={() => {
                navigator.clipboard.writeText(code);
                toast.success("Code copied to clipboard!");
              }}
              className="hover:text-foreground transition cursor-pointer"
            >
              Copy
            </button>
          </div>
          <pre className="p-3 overflow-x-auto whitespace-pre leading-relaxed">
            <code>{code}</code>
          </pre>
        </div>
      );
    }
    return <p key={idx} className="whitespace-pre-wrap select-text font-sans break-words">{part}</p>;
  });
}function CompanionDrawer({ onClose }: { onClose: () => void }) {
  const { user } = useCortexAuth();
  const userId = user?.user_id;
  const displayName = user?.first_name || "";

  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string; references?: any[] }[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedMode, setSelectedMode] = useState<string>("general");
  const [selectedDocId, setSelectedDocId] = useState<string>("all");
  const [documents, setDocuments] = useState<any[]>([]);
  const [ollamaStatus, setOllamaStatus] = useState<string>("OLLAMA_ONLINE_MODEL_AVAILABLE");
  const [configuredModel, setConfiguredModel] = useState<string>("qwen2.5-coder:3b");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [lensLoading, setLensLoading] = useState(false);
  const [attachedImageBase64, setAttachedImageBase64] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Listen for custom trigger queries from command palette or other shortcuts
  useEffect(() => {
    const handleQuery = (e: Event) => {
      const query = (e as CustomEvent).detail;
      if (query) {
        setInputValue(query);
      }
    };
    window.addEventListener("cortex:open-companion-query", handleQuery);
    return () => {
      window.removeEventListener("cortex:open-companion-query", handleQuery);
    };
  }, []);

  // Load chat history & docs on mount or user change
  useEffect(() => {
    if (!userId || userId === -1) {
      setMessages([]);
      return;
    }

    const checkHealth = () => {
      cortexClient.getAssistantHealth().then(res => {
        setOllamaStatus(res.status);
        if (res.model_name) setConfiguredModel(res.model_name);
        if (res.models_available) setAvailableModels(res.models_available);
      }).catch(() => setOllamaStatus("OLLAMA_OFFLINE"));
    };

    checkHealth();
    const healthInterval = setInterval(checkHealth, 8000);

    cortexClient.getDocuments(userId).then(docs => {
      setDocuments(docs || []);
    }).catch(console.error);

    const syncChat = () => {
      cortexClient.getChatHistory(userId).then(hist => {
        if (hist && hist.length > 0) {
          setMessages(prev => {
            if (prev.length !== hist.length) {
              return hist.map(h => ({
                role: h.role === "user" ? "user" : "assistant",
                content: h.content
              }));
            }
            return prev;
          });
        } else {
          setMessages([
            { role: "assistant", content: `Hello ${displayName || "there"} — I am Cortex, your productivity companion. How can I help you focus today?` }
          ]);
        }
      }).catch(err => {
        console.error("Failed to load chat history:", err);
      });
    };

    syncChat();
    const interval = setInterval(syncChat, 5000);
    return () => {
      clearInterval(healthInterval);
      clearInterval(interval);
    };
  }, [userId, displayName]);

  const handleSend = async () => {
    if ((!inputValue.trim() && !attachedImageBase64) || isStreaming || !userId || userId === -1) return;

    const userText = inputValue.trim() || "Analyze this image.";
    const imgPayload = attachedImageBase64;
    setInputValue("");
    setAttachedImageBase64(null);
    
    // Optimistically update message stream
    setMessages(prev => [...prev, { role: "user", content: userText }]);
    setMessages(prev => [...prev, { role: "assistant", content: "..." }]);
    setIsStreaming(true);

    let streamText = "";
    try {
      await cortexClient.chatStream(
        userId,
        userText,
        selectedMode,
        selectedDocId,
        (chunk) => {
          if (chunk === "OLLAMA_OFFLINE") {
            streamText = "Ollama is currently offline. Please start local Ollama to enable AI assistance.";
          } else if (chunk === "OPENAI_NOT_CONFIGURED") {
            streamText = "OpenAI API key is not configured. Please add OPENAI_API_KEY to your environment variables (.env file) to chat.";
          } else {
            if (streamText === "") {
              streamText = chunk;
            } else {
              streamText += chunk;
            }
          }
          setMessages(prev => {
            const next = [...prev];
            if (next.length > 0 && next[next.length - 1].role === "assistant") {
              next[next.length - 1] = { ...next[next.length - 1], content: streamText };
            }
            return next;
          });
        },
        (refs) => {
          setMessages(prev => {
            const next = [...prev];
            if (next.length > 0 && next[next.length - 1].role === "assistant") {
              next[next.length - 1] = { ...next[next.length - 1], references: refs };
            }
            return next;
          });
        },
        imgPayload || undefined
      );
    } catch (err) {
      console.error(err);
      setMessages(prev => {
        const next = [...prev];
        if (next.length > 0 && next[next.length - 1].role === "assistant") {
          next[next.length - 1] = {
            role: "assistant",
            content: "The AI model is currently offline or not configured. Start local Ollama to chat."
          };
        }
        return next;
      });
    } finally {
      setIsStreaming(false);
    }
  };

  const handleClearChat = async () => {
    if (!userId || userId === -1) return;
    try {
      await cortexClient.clearChatHistory(userId);
      setMessages([
        { role: "assistant", content: "Conversation cleared. Ask me anything!" }
      ]);
      toast.success("Chat history cleared successfully.");
    } catch (err) {
      console.error("Failed to clear chat:", err);
      toast.error("Failed to clear chat history.");
    }
  };

  const handleLensTrigger = async () => {
    const api = (window as any).cortexAPI;
    if (!api || !api.startLens) {
      toast.error("Lens screen capture is only supported inside the Desktop App container.");
      return;
    }

    try {
      setLensLoading(true);
      const croppedBase64 = await api.startLens();
      if (croppedBase64) {
        setAttachedImageBase64(croppedBase64);
        toast.success("Selection captured! Add a message and send.");
      }
    } catch (err) {
      console.error("Lens trigger failed:", err);
      toast.error("Failed to initialize screen selection mode.");
    } finally {
      setLensLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setAttachedImageBase64(event.target?.result as string);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };



  return (
    <div className="flex h-full flex-col bg-surface-1/95 backdrop-blur-xl border-l border-border text-foreground font-sans select-none">
      {/* Header */}
      <div className="flex h-16 items-center justify-between border-b border-border px-4 drag-region">
        <div className="flex items-center gap-2 select-none no-drag-region">
          <Sparkles className="h-4 w-4 text-white" />
          <span className="font-semibold text-sm tracking-wide">Cortex Companion</span>
          <span className={`h-1.5 w-1.5 rounded-full ${
            ollamaStatus === "OLLAMA_ONLINE_MODEL_AVAILABLE" || ollamaStatus === "OPENAI_AVAILABLE"
              ? "bg-emerald-500"
              : ollamaStatus === "OLLAMA_ONLINE_MODEL_MISSING"
              ? "bg-amber-500"
              : "bg-red-500"
          }`} title={
            ollamaStatus === "OLLAMA_ONLINE_MODEL_AVAILABLE" || ollamaStatus === "OPENAI_AVAILABLE"
              ? "Local AI Connected"
              : ollamaStatus === "OLLAMA_ONLINE_MODEL_MISSING"
              ? "Model Not Found"
              : "AI Offline"
          } />
        </div>
        <div className="flex items-center gap-1.5 no-drag-region">
          <button
            onClick={handleClearChat}
            className="grid h-7 w-7 place-items-center rounded hover:bg-surface-2 text-muted-foreground hover:text-foreground cursor-pointer transition"
            title="Clear Chat"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => {
              onClose();
              if ((window as any).cortexAPI?.showCompanionWidget) {
                (window as any).cortexAPI.showCompanionWidget();
              }
            }}
            className="grid h-7 w-7 place-items-center rounded hover:bg-surface-2 text-muted-foreground hover:text-foreground cursor-pointer transition"
            title="Minimize to Floating Desktop Companion"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded hover:bg-surface-2 text-muted-foreground hover:text-foreground cursor-pointer transition"
            title="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Mode and Resource selectors */}
      <div className="flex flex-col border-b border-border bg-surface-2/10 p-2.5 gap-2 text-xs">
        <div className="flex items-center justify-between gap-1.5 font-sans">
          <span className="text-muted-foreground">Mode:</span>
          <select
            value={selectedMode}
            onChange={(e) => setSelectedMode(e.target.value)}
            className="rounded border border-border bg-surface-2 px-2 py-1 text-xs text-foreground outline-none cursor-pointer focus:border-foreground/30 flex-1"
          >
            <option value="general">General (Ground on active stats)</option>
            <option value="notes">Ask Notes (RAG)</option>
            <option value="summarize">Summarize document</option>
            <option value="coding">Coding Coach</option>
            <option value="viva">Viva Prep</option>
          </select>
        </div>

        {["notes", "summarize"].includes(selectedMode) && (
          <div className="flex items-center justify-between gap-1.5 font-sans">
            <span className="text-muted-foreground">Attach:</span>
            <select
              value={selectedDocId}
              onChange={(e) => setSelectedDocId(e.target.value)}
              className="rounded border border-border bg-surface-2 px-2 py-1 text-xs text-foreground outline-none cursor-pointer focus:border-foreground/30 flex-1"
            >
              <option value="all">All Materials</option>
              {documents
                .filter((d) => d.status === "ready")
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.original_filename}
                  </option>
                ))}
            </select>
          </div>
        )}
      </div>

      {/* Message List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 select-text">
        {ollamaStatus === "OLLAMA_OFFLINE" && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-400 select-none font-sans space-y-1">
            <div className="font-semibold flex items-center gap-1.5 text-red-500">
              <span className="h-2 w-2 rounded-full bg-red-500 animate-ping" />
              Ollama Offline
            </div>
            <p className="text-muted-foreground leading-normal">
              Could not reach local Ollama on <code>http://127.0.0.1:11434</code>. Please verify Ollama is running, or click below to retry.
            </p>
            <button
              onClick={() => {
                cortexClient.getAssistantHealth().then(res => {
                  setOllamaStatus(res.status);
                  if (res.model_name) setConfiguredModel(res.model_name);
                  if (res.models_available) setAvailableModels(res.models_available);
                  toast.success("Ollama connection updated.");
                }).catch(() => toast.error("Ollama is still offline."));
              }}
              className="mt-1.5 px-2.5 py-1 rounded bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-[10px] font-medium transition cursor-pointer"
            >
              Retry Connection
            </button>
          </div>
        )}



        {ollamaStatus === "OLLAMA_ERROR" && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-400 select-none font-sans space-y-1">
            <div className="font-semibold flex items-center gap-1.5 text-amber-500">
              ⚠️ Ollama Connection Error
            </div>
            <p className="text-muted-foreground leading-normal">
              An error occurred while validating the local model tag index. Please verify your Ollama status.
            </p>
          </div>
        )}
        
        {messages.map((m, idx) => (
          <div
            key={idx}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                m.role === "user"
                  ? "bg-foreground text-background font-medium"
                  : "bg-surface-2 text-foreground border border-border"
              }`}
            >
              {m.role === "user" ? (
                <p className="whitespace-pre-wrap select-text">{m.content}</p>
              ) : (
                <>
                  {renderMessageText(m.content)}
                  {m.references && m.references.length > 0 && (
                    <div className="mt-2.5 border-t border-border/40 pt-1.5 text-[10px] text-muted-foreground flex flex-col gap-1 select-none font-sans">
                      <span className="font-semibold text-foreground/80">Grounding Citations:</span>
                      {m.references.map((ref, rIdx) => (
                        <div key={rIdx} className="truncate">
                          📄 {ref.filename} {ref.page ? `· Page ${ref.page}` : ""}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Inputs */}
      <div className="border-t border-border p-3 space-y-2 bg-surface-1">
        {attachedImageBase64 && (
          <div className="relative inline-block border border-border rounded p-1 bg-surface-2 mb-2">
            <img src={attachedImageBase64} alt="Attached" className="h-16 w-auto object-cover rounded" />
            <button 
              onClick={() => setAttachedImageBase64(null)}
              className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5 hover:bg-red-600 shadow cursor-pointer transition"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask Cortex about your work..."
            rows={2}
            className="w-full resize-none rounded-lg border border-border bg-surface-2 p-2.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/30 leading-normal"
          />
          
          <div className="flex items-center justify-between select-none">
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleLensTrigger}
                disabled={lensLoading}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[10px] hover:bg-surface-3 transition cursor-pointer text-muted-foreground hover:text-foreground disabled:opacity-50"
                title="Capture region screenshot"
              >
                <Camera className="h-3.5 w-3.5" /> {lensLoading ? "Starting..." : "Lens"}
              </button>
              <input 
                type="file" 
                accept="image/jpeg, image/png, image/webp" 
                className="hidden" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[10px] hover:bg-surface-3 transition cursor-pointer text-muted-foreground hover:text-foreground"
                title="Attach an image"
              >
                <Paperclip className="h-3.5 w-3.5" /> Attach
              </button>
              <button
                disabled
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[10px] text-muted-foreground opacity-50 cursor-not-allowed"
                title="Voice dictation (future release)"
              >
                <Mic className="h-3.5 w-3.5" /> Mic
              </button>
            </div>
            
            <button
              onClick={handleSend}
              disabled={(!inputValue.trim() && !attachedImageBase64) || isStreaming}
              className="inline-flex items-center justify-center rounded-lg bg-foreground text-background px-3 py-1.5 text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition cursor-pointer"
            >
              <Send className="h-3 w-3 mr-1" /> Send
            </button>
          </div>
        </div>
    </div>
  );
}
