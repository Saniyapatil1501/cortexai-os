import { ReactNode, useState, useEffect } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
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
  Activity,
} from "lucide-react";
import { Logo } from "./Logo";
import { AmbientBackground } from "./AmbientBackground";
import { AssistantOrb } from "./AssistantOrb";
import { cortexClient } from "@/lib/api";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/assistant", label: "AI Assistant", icon: Sparkles },
  { to: "/focus", label: "Focus", icon: Timer },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/reminders", label: "Reminders", icon: Bell },
  { to: "/settings", label: "Settings", icon: Settings },
];

let remindersIntervalStarted = false;
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

function startRemindersLoop() {
  if (remindersIntervalStarted) return;
  remindersIntervalStarted = true;

  const checkReminders = async () => {
    try {
      const reminders = await cortexClient.getReminders(1);
      const now = new Date();
      const nowMs = now.getTime();

      for (const rem of reminders) {
        if (!rem.is_enabled) continue;

        const intervalStr = rem.recurrence_interval.toLowerCase().trim();
        if (intervalStr === "session_start") {
          continue;
        }

        const durationMatch = intervalStr.match(/every\s+(\d+)\s*(m|min|minute|minutes|h|hr|hour|hours)?/);
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
  setInterval(checkReminders, 30000);
}

export function AppLayout({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    startRemindersLoop();
  }, []);

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
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/70 px-4 backdrop-blur-xl md:px-6">
            <button
              onClick={() => setMobileOpen(true)}
              className="grid h-9 w-9 place-items-center rounded-md border border-border text-muted-foreground hover:text-foreground lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-4 w-4" />
            </button>

            <div className="hidden md:flex items-center gap-2 rounded-md border border-border bg-surface-1/60 px-3 py-1.5 w-[360px] max-w-full">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                placeholder="Search anything or ask Cortex…"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <kbd className="hidden md:inline-flex items-center gap-1 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                <Command className="h-3 w-3" /> K
              </kbd>
            </div>

            <div className="flex-1" />

            <div className="hidden sm:flex items-center gap-2 rounded-md border border-border bg-surface-1/60 px-2.5 py-1.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/40" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              <span className="text-xs text-muted-foreground">Cortex online</span>
            </div>

            <div className="hidden md:flex items-center gap-2 rounded-md border border-border bg-surface-1/60 px-3 py-1.5">
              <Activity className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Productivity</span>
              <span className="text-xs font-semibold">87%</span>
            </div>

            <button className="grid h-9 w-9 place-items-center rounded-md border border-border text-muted-foreground hover:text-foreground">
              <Bell className="h-4 w-4" />
            </button>

            <div className="h-9 w-9 rounded-full bg-gradient-to-br from-surface-3 to-surface-1 border border-border grid place-items-center text-xs font-semibold">
              AK
            </div>
          </header>

          <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
        </div>
      </div>
      <AssistantOrb />
    </div>
  );
}

function SidebarInner({ path, onNavigate }: { path: string; onNavigate?: () => void }) {
  return (
    <>
      <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-5">
        <Logo showWord />
        {onNavigate && (
          <button onClick={onNavigate} className="text-muted-foreground lg:hidden">
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
      <div className="m-3 rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-3">
        <div className="text-xs font-medium">Pro tier</div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          Unlock unlimited focus sessions and advanced AI workflows.
        </div>
        <button className="mt-3 w-full rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground hover:opacity-90">
          Upgrade
        </button>
      </div>
    </>
  );
}
