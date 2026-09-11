import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppLayout } from "@/components/cortex/AppLayout";
import { Card, PageHeader, Stat, Button } from "@/components/cortex/ui";
import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { Play, Pause, Sparkles, Clock, Code2, BookOpen, Coffee, Plus } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { cortexClient } from "@/lib/api";
import { useCortexAuth } from "@/hooks/useCortexAuth";
import { parseUTCDateTime } from "@/lib/utils";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — CortexAI" },
      { name: "description", content: "Your CortexAI productivity command center." },
    ],
  }),
  component: Dashboard,
});

const defaultChartData: any[] = [];

const defaultApps: any[] = [];

// suggestions array is now dynamically queried from backend API

function Dashboard() {
  const navigate = useNavigate();
  const {
    user,
    isBackendOffline,
    retrySync,
    isLoading: isAuthLoading,
    isSignedIn,
    activeSession,
    running,
    elapsed,
    activeState,
    activeApp,
    activeTitle,
    activeReason,
    timelineEvents,
    summary,
    chartData,
    apps,
    recentSessions,
    startFocusSession,
    endFocusSession,
  } = useCortexAuth();
  
  const userId = user?.user_id;
  const displayName = user?.first_name || "";

  const [reminders, setReminders] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [recentLogs, setRecentLogs] = useState<any[]>([]);
  const [currentAppDuration, setCurrentAppDuration] = useState(0);

  useEffect(() => {
    setCurrentAppDuration(0);
  }, [activeApp, activeTitle]);

  useEffect(() => {
    if (running) return;
    const timer = setInterval(() => {
      setCurrentAppDuration((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [running, activeApp, activeTitle]);

  const displayDurationSeconds = running ? elapsed : currentAppDuration;
  const displayMin = Math.floor(displayDurationSeconds / 60);
  const displaySec = displayDurationSeconds % 60;

  const fetchDashboardSpecificData = useCallback(() => {
    if (!userId || userId === -1) return;

    cortexClient
      .getReminders(userId)
      .then((rems) => {
        if (rems && rems.length > 0) {
          setReminders(rems.filter((r) => r.is_enabled).slice(0, 3));
        } else {
          setReminders([]);
        }
      })
      .catch(console.error);

    cortexClient
      .getSuggestions(userId)
      .then((sugs) => {
        if (sugs && sugs.length > 0) {
          setSuggestions(sugs);
        } else {
          setSuggestions([]);
        }
      })
      .catch(console.error);

    cortexClient
      .getRecentActivityLogs(userId, 10)
      .then((logs) => {
        setRecentLogs(logs || []);
      })
      .catch(console.error);
  }, [userId]);

  // Initial fetch on mount or user change
  useEffect(() => {
    if (!userId || userId === -1) {
      setReminders([]);
      setSuggestions([]);
      setRecentLogs([]);
      return;
    }

    fetchDashboardSpecificData();
    const interval = setInterval(fetchDashboardSpecificData, 5000);
    return () => clearInterval(interval);
  }, [userId, fetchDashboardSpecificData]);

  if (isBackendOffline) {
    return (
      <AppLayout>
        <PageHeader title="Dashboard" description="Your CortexAI productivity command center." />
        <div className="flex h-[50vh] flex-col items-center justify-center gap-4 text-center">
          <div className="text-lg font-medium text-destructive">Daemon Offline</div>
          <div className="max-w-md text-sm text-muted-foreground">
            The CortexAI Desktop Daemon is currently offline. Please ensure the backend is running
            and try again.
          </div>
          <Button onClick={retrySync} className="mt-2">
            Retry Connection
          </Button>
        </div>
      </AppLayout>
    );
  }

  if (isAuthLoading) {
    return (
      <AppLayout>
        <div className="flex h-[50vh] items-center justify-center text-sm text-muted-foreground">
          Syncing workspace session...
        </div>
      </AppLayout>
    );
  }

  if (!isSignedIn) {
    return (
      <AppLayout>
        <div className="flex h-[50vh] items-center justify-center text-sm text-muted-foreground">
          Redirecting to login...
        </div>
      </AppLayout>
    );
  }

  if (!userId) {
    return (
      <AppLayout>
        <div className="flex h-[50vh] flex-col items-center justify-center gap-4 text-center">
          <div className="text-lg font-medium text-destructive">Session Sync Failed</div>
          <div className="max-w-md text-sm text-muted-foreground">
            We were unable to synchronize your session with the local desktop daemon database.
          </div>
          <Button onClick={retrySync} className="mt-2">
            Retry Sync
          </Button>
        </div>
      </AppLayout>
    );
  }

  // Format focus duration
  const getFocusHoursString = () => {
    if (!summary?.today?.focus_seconds) return "0h 00m";
    const hours = Math.floor(summary.today.focus_seconds / 3600);
    const minutes = Math.floor((summary.today.focus_seconds % 3600) / 60);
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  };

  const handleQuickAction = (action: string) => {
    if (!userId) return;
    if (action === "Start focus") {
      startFocusSession("Pomodoro Sprint", 25 * 60, "study")
        .then(() => navigate({ to: "/focus" }))
        .catch(console.error);
    } else if (action === "Take break") {
      startFocusSession("Quick break", 5 * 60, "break")
        .then(() => navigate({ to: "/focus" }))
        .catch(console.error);
    } else if (action === "Coding mode") {
      startFocusSession("Deep coding flow", 50 * 60, "coding")
        .then(() => navigate({ to: "/focus" }))
        .catch(console.error);
    } else if (action === "Study mode") {
      startFocusSession("Focused reading and study", 50 * 60, "study")
        .then(() => navigate({ to: "/focus" }))
        .catch(console.error);
    }
  };

  return (
    <AppLayout>
      <PageHeader
        title={`Good afternoon, ${displayName}`}
        description="Here's how your focus and work are unfolding today."
        actions={
          <Link to="/assistant">
            <Button>
              <Sparkles className="h-4 w-4" /> Ask Cortex
            </Button>
          </Link>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card className="p-4 flex flex-col justify-between">
          <Stat
            label="Productivity score"
            value={summary ? String(summary.score) : "0"}
            hint="vs 0 last week"
          />
        </Card>
        <Card className="p-4 flex flex-col justify-between">
          <Stat label="Focus hours" value={getFocusHoursString()} hint="today" />
        </Card>
        <Card className="p-4 flex flex-col justify-between">
          <Stat
            label="Distractions"
            value={summary?.today ? String(summary.today.distraction_count) : "0"}
            hint="contexts switched"
          />
        </Card>
        <Card className="p-4 flex flex-col justify-between">
          <Stat
            label="Sessions"
            value={summary?.today ? String(summary.today.sessions_count) : "0"}
            hint="completed today"
          />
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-sm font-medium">Weekly productivity</div>
              <div className="text-xs text-muted-foreground">
                Focus vs distraction · last 14 days
              </div>
            </div>
            <div className="flex gap-1 text-xs text-muted-foreground">
              <Legend dot="bg-foreground" label="Focus" />
              <Legend dot="bg-foreground/30" label="Distraction" />
            </div>
          </div>
          <div className="h-64">
            {chartData && chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="white" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="white" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis
                    dataKey="day"
                    stroke="rgba(255,255,255,0.35)"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="rgba(255,255,255,0.35)"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "rgba(20,20,22,0.95)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="focus"
                    stroke="white"
                    strokeWidth={1.5}
                    fill="url(#g1)"
                  />
                  <Area
                    type="monotone"
                    dataKey="distraction"
                    stroke="rgba(255,255,255,0.4)"
                    strokeWidth={1}
                    fill="transparent"
                    strokeDasharray="3 3"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground select-none font-sans border border-dashed border-border/40 rounded-md bg-surface-1/10">
                Not enough activity history yet
              </div>
            )}
          </div>
        </Card>

        <PomodoroCard />
      </div>

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-medium">Active now</div>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Live tracking</span>
          </div>
          <div className="space-y-4">
            {activeApp ? (
              <div className="space-y-3 font-sans select-none animate-in fade-in duration-300">
                <div>
                  <div className="text-xs text-muted-foreground">Application</div>
                  <div className="text-sm font-medium text-foreground mt-0.5">{activeApp || "System"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Window Title</div>
                  <div className="text-xs font-mono text-foreground/80 mt-0.5 truncate" title={activeTitle || ""}>
                    {activeTitle || "Active Workspace"}
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex-1">
                    <div className="text-xs text-muted-foreground">Duration</div>
                    <div className="text-sm font-medium text-foreground mt-0.5">
                      {displayMin}m {displaySec}s
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="text-xs text-muted-foreground">Classification</div>
                    <div className="text-xs font-semibold uppercase mt-1 inline-block px-1.5 py-0.5 rounded border border-border bg-surface-2">
                      {activeState}
                    </div>
                  </div>
                </div>
                {activeReason && (
                  <div>
                    <div className="text-xs text-muted-foreground">Reason/Context</div>
                    <div className="text-xs text-muted-foreground mt-0.5 italic leading-relaxed">
                      {activeReason}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground py-12 text-center select-none font-sans">
                Initializing Cortex workspace tracker...
              </div>
            )}
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> Cortex suggestions
            </div>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">live</span>
          </div>
          <div className="space-y-3">
            {suggestions.length > 0 ? (
              suggestions.map((s, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08 }}
                  className="rounded-md border border-border bg-surface-1/60 p-3 text-sm leading-relaxed"
                >
                  {s}
                </motion.div>
              ))
            ) : (
              <div className="text-xs text-muted-foreground py-8 text-center select-none">
                Analyzing your workspace activity to generate personalized coaching insights...
              </div>
            )}
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-medium">Recent activity</div>
            <div className="text-xs text-muted-foreground">Session timeline</div>
          </div>
          <div className="space-y-3 overflow-y-auto max-h-[220px] pr-1">
            {recentLogs && recentLogs.length > 0 ? (
              recentLogs.map((evt, i) => {
                const startTimeStr = evt.timestamp
                  ? parseUTCDateTime(evt.timestamp).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : "";
                const durMin = Math.round(evt.duration_seconds / 60);
                const durStr = durMin > 0 ? `${durMin}m` : `${evt.duration_seconds}s`;

                return (
                  <div key={i} className="rounded-md border border-border bg-surface-1/40 p-2.5 text-xs font-sans space-y-1 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between text-muted-foreground select-none">
                      <span>{startTimeStr}</span>
                      <span className="font-semibold uppercase tracking-wider text-[9px] px-1 rounded border border-border bg-surface-2">
                        {evt.category}
                      </span>
                    </div>
                    <div className="flex justify-between items-start gap-2">
                      <div className="font-medium text-foreground truncate max-w-[70%]" title={evt.app_name}>
                        {evt.app_name || "System"}
                      </div>
                      <div className="text-muted-foreground shrink-0">{durStr}</div>
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate" title={evt.reason || evt.window_title}>
                      {evt.reason || evt.window_title || "Productive work"}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-xs text-muted-foreground py-12 text-center select-none font-sans">
                No recent activity events recorded. Active workspace context is recorded continuously.
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <div className="text-sm font-medium mb-4">Quick actions</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { icon: Clock, label: "Start focus" },
              { icon: Coffee, label: "Take break" },
              { icon: Code2, label: "Coding mode" },
              { icon: BookOpen, label: "Study mode" },
            ].map((a, i) => (
              <button
                key={i}
                onClick={() => handleQuickAction(a.label)}
                className="group flex flex-col items-start gap-3 rounded-md border border-border bg-surface-1/60 p-4 text-left transition hover:bg-surface-2 cursor-pointer"
              >
                <a.icon className="h-4 w-4 text-muted-foreground transition group-hover:text-foreground" />
                <span className="text-sm">{a.label}</span>
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <div className="text-sm font-medium mb-3">Upcoming reminders</div>
          <ul className="space-y-3 text-sm">
            {reminders.length > 0 ? (
              reminders.map((r) => (
                <ReminderRow key={r.id} label={r.title} time={r.recurrence_interval} />
              ))
            ) : (
              <div className="text-xs text-muted-foreground py-4 text-center select-none">
                No reminders registered in database. Syncing session to load defaults...
              </div>
            )}
          </ul>
        </Card>
      </div>
    </AppLayout>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${dot}`} /> {label}
    </span>
  );
}

function ReminderRow({ label, time }: { label: string; time: string }) {
  return (
    <li className="flex items-center justify-between rounded-md border border-border bg-surface-1/50 px-3 py-2">
      <span>{label}</span>
      <span className="text-xs text-muted-foreground">{time}</span>
    </li>
  );
}

function PomodoroCard() {
  const {
    activeSession,
    running,
    elapsed,
    startFocusSession,
    endFocusSession,
    pauseFocusSession,
    resumeFocusSession,
  } = useCortexAuth();

  const total = activeSession?.target_duration_seconds || 25 * 60;
  const remaining = Math.max(0, total - elapsed);
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");
  const pct = running ? Math.min(1.0, elapsed / total) : 0;

  const handleStart = () => {
    startFocusSession("Dashboard Pomodoro sprint", 25 * 60)
      .then(() => {
        if ((window as any).cortexAPI?.sendNotification) {
          (window as any).cortexAPI.sendNotification(
            "Focus Session Started",
            'Focus intention: "Dashboard Pomodoro sprint"',
          );
        }
      })
      .catch(console.error);
  };

  const handleStop = () => {
    if (activeSession) {
      endFocusSession(false, elapsed)
        .then(() => {
          if ((window as any).cortexAPI?.sendNotification) {
            (window as any).cortexAPI.sendNotification(
              "Focus Session Stopped",
              "Focus session has been stopped manually.",
            );
          }
        })
        .catch(console.error);
    }
  };

  const handleSkip = () => {
    if (activeSession) {
      endFocusSession(false, elapsed, "skipped")
        .then(() => {
          if ((window as any).cortexAPI?.sendNotification) {
            (window as any).cortexAPI.sendNotification(
              "Focus Session Skipped",
              "Focus session has been skipped.",
            );
          }
        })
        .catch(console.error);
    }
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium">Pomodoro</div>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {activeSession ? (activeSession.status === "paused" ? "Paused" : "Active") : "Ready"}
        </span>
      </div>
      <div className="relative mx-auto my-3 grid place-items-center">
        <svg viewBox="0 0 120 120" className="h-44 w-44 -rotate-90">
          <circle
            cx="60"
            cy="60"
            r="54"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="6"
            fill="none"
          />
          <circle
            cx="60"
            cy="60"
            r="54"
            stroke="white"
            strokeWidth="6"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 54}
            strokeDashoffset={2 * Math.PI * 54 * (1 - pct)}
            className="transition-[stroke-dashoffset] duration-1000"
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center">
            <div className="text-3xl font-semibold tracking-tight tabular-nums">
              {mm}:{ss}
            </div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mt-1">
              focus
            </div>
          </div>
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        {!activeSession ? (
          <Button className="w-full" onClick={handleStart}>
            <Play className="h-4 w-4 mr-2" /> Start Focus
          </Button>
        ) : (
          <>
            <Button
              className="flex-1"
              onClick={activeSession.status === "paused" ? resumeFocusSession : pauseFocusSession}
            >
              {activeSession.status === "paused" ? <Play className="h-4 w-4 mr-1.5" /> : <Pause className="h-4 w-4 mr-1.5" />}
              {activeSession.status === "paused" ? "Resume" : "Pause"}
            </Button>
            <Button variant="outline" className="flex-1" onClick={handleStop}>
              Stop
            </Button>
            <Button variant="outline" className="w-full mt-1.5" onClick={handleSkip}>
              Skip Session
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
