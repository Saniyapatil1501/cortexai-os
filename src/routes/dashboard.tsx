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
import { useState, useEffect } from "react";
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
  } = useCortexAuth();
  const userId = user?.user_id;
  const displayName = user?.first_name || "";

  const [summary, setSummary] = useState<any>(null);
  const [chartData, setChartData] = useState<any[]>(defaultChartData);
  const [apps, setApps] = useState<any[]>(defaultApps);
  const [reminders, setReminders] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [recentSessions, setRecentSessions] = useState<any[]>([]);

  useEffect(() => {
    if (!userId) return;

    const fetchData = () => {
      cortexClient
        .getActivitySummary(userId)
        .then((sum) => {
          setSummary(sum);
        })
        .catch(console.error);

      cortexClient
        .getProductivityAnalytics(userId)
        .then((chart) => {
          if (chart && chart.length > 0) setChartData(chart);
        })
        .catch(console.error);

      cortexClient
        .getAppsAnalytics(userId)
        .then((activeApps) => {
          if (activeApps && activeApps.length > 0) setApps(activeApps.slice(0, 4));
        })
        .catch(console.error);

      cortexClient
        .getReminders(userId)
        .then((rems) => {
          if (rems && rems.length > 0) {
            setReminders(rems.filter((r) => r.is_enabled).slice(0, 3));
          }
        })
        .catch(console.error);

      cortexClient
        .getSuggestions(userId)
        .then((sugs) => {
          if (sugs && sugs.length > 0) setSuggestions(sugs);
        })
        .catch(console.error);

      cortexClient
        .getRecentFocusSessions(userId)
        .then((recs) => {
          if (recs) setRecentSessions(recs);
        })
        .catch(console.error);
    };

    fetchData();
    const interval = setInterval(fetchData, 10000); // refresh every 10s
    return () => clearInterval(interval);
  }, [userId]);

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
    if (action === "Start focus" || action === "Take break") {
      navigate({ to: "/focus" });
    } else if (action === "Coding mode") {
      cortexClient
        .startFocusSession(userId, "Deep coding flow", 50 * 60)
        .then(() => {
          navigate({ to: "/focus" });
        })
        .catch(console.error);
    } else if (action === "Study mode") {
      cortexClient
        .startFocusSession(userId, "Focused reading and study", 50 * 60)
        .then(() => {
          navigate({ to: "/focus" });
        })
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
          </div>
        </Card>

        <PomodoroCard userId={userId} />
      </div>

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-medium">Active apps</div>
            <div className="text-xs text-muted-foreground">today</div>
          </div>
          <div className="space-y-4">
            {apps.length > 0 ? (
              apps.map((a) => (
                <div key={a.name}>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      {a.type === "code" ? (
                        <Code2 className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      <span>{a.name}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{a.time}</span>
                  </div>
                  <div className="mt-2 h-1 rounded-full bg-surface-3 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${a.pct}%` }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                      className="h-full bg-foreground/80"
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="text-xs text-muted-foreground py-10 text-center select-none">
                No apps tracked today. Declare an intention and start focusing!
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
            <div className="text-sm font-medium">Recent sessions</div>
            <div className="text-xs text-muted-foreground">today</div>
          </div>
          <div className="space-y-3">
            {recentSessions.length > 0 ? (
              recentSessions.map((s, i) => {
                const durationMinutes = Math.round(s.duration_seconds / 60);
                const durStr =
                  durationMinutes >= 60
                    ? `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`
                    : `${durationMinutes}m`;

                let tagStr = "Focus";
                if (s.intention.toLowerCase().includes("code")) tagStr = "Code";
                else if (
                  s.intention.toLowerCase().includes("read") ||
                  s.intention.toLowerCase().includes("study")
                )
                  tagStr = "Study";

                return (
                  <div key={s.id || i} className="flex items-center justify-between text-sm">
                    <div className="min-w-0">
                      <div className="truncate" title={s.intention}>
                        {s.intention}
                      </div>
                      <div className="text-xs text-muted-foreground">{durStr}</div>
                    </div>
                    <span className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      {tagStr}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="text-xs text-muted-foreground py-10 text-center select-none">
                No recent focus sessions completed today.
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

function PomodoroCard({ userId }: { userId: number }) {
  const [activeSession, setActiveSession] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(25 * 60);

  // Dynamic total length based on active session configuration
  const total = activeSession?.target_duration_seconds || 25 * 60;

  useEffect(() => {
    if (!userId) return;

    const checkSession = () => {
      cortexClient
        .getActiveFocusSession(userId)
        .then((sess) => {
          if (sess) {
            setActiveSession(sess);
            setRunning(true);
            const startTime = parseUTCDateTime(sess.started_at).getTime();
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const target = sess.target_duration_seconds || 25 * 60;
            const calculatedRemaining = Math.max(0, target - elapsed);
            setSeconds((current) => {
              // Only update if difference is significant to avoid countdown jumps due to clock drift
              if (Math.abs(current - calculatedRemaining) > 3) {
                return calculatedRemaining;
              }
              return current;
            });
          } else {
            setActiveSession(null);
            setRunning(false);
            setSeconds(25 * 60);
          }
        })
        .catch(console.error);
    };

    checkSession();
    const interval = setInterval(checkSession, 5000);
    return () => clearInterval(interval);
  }, [userId]);

  useEffect(() => {
    if (!running || !activeSession) return;
    const t = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          clearInterval(t);
          cortexClient
            .endFocusSession(activeSession.id, true, 0)
            .then(() => {
              setActiveSession(null);
              setRunning(false);
              setSeconds(25 * 60);
              if ((window as any).cortexAPI?.sendNotification) {
                (window as any).cortexAPI.sendNotification(
                  "Focus Session Completed!",
                  "Your Pomodoro session has completed! Take a break.",
                );
              }
            })
            .catch(console.error);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [running, activeSession]);

  const handleStart = () => {
    if (!userId) return;
    cortexClient
      .startFocusSession(userId, "Dashboard Pomodoro sprint", 25 * 60)
      .then((sess) => {
        setActiveSession(sess);
        setRunning(true);
        setSeconds(25 * 60);
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
      cortexClient
        .endFocusSession(activeSession.id, false, 0)
        .then(() => {
          setActiveSession(null);
          setRunning(false);
          setSeconds(25 * 60);
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

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  const pct = 1 - seconds / total;

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium">Pomodoro</div>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {running ? "Active" : "Ready"}
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
      <div className="flex gap-2">
        <Button className="flex-1" onClick={running ? handleStop : handleStart}>
          {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {running ? "Stop" : "Start"}
        </Button>
        <Button variant="outline" className="flex-1" onClick={handleStop} disabled={!running}>
          Skip
        </Button>
      </div>
    </Card>
  );
}
