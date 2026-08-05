import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Pause, Play, RotateCcw, Volume2 } from "lucide-react";
import { cortexClient, FocusSession } from "@/lib/api";
import { AppLayout } from "@/components/cortex/AppLayout";
import { Card, PageHeader, Button } from "@/components/cortex/ui";
import { motion } from "framer-motion";
import { useCortexAuth } from "@/hooks/useCortexAuth";
import { parseUTCDateTime } from "@/lib/utils";

export const Route = createFileRoute("/focus")({
  head: () => ({
    meta: [
      { title: "Focus — CortexAI" },
      { name: "description", content: "Immersive focus sessions with intelligent distraction tracking." },
    ],
  }),
  component: FocusPage,
});

function FocusPage() {
  const { user } = useCortexAuth();
  const userId = user?.user_id;

  const [activeSession, setActiveSession] = useState<FocusSession | null>(null);
  const [intention, setIntention] = useState("Finish authentication refactor");
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0); // seconds
  const [distractions, setDistractions] = useState({ tabSwitch: 0, appSwap: 0, idle: 0 });
  const [todayStats, setTodayStats] = useState({ sessions: 0, focusMinutes: 0 });
  
  // Total default duration (50 minutes) or dynamic target duration from backend active session
  const total = activeSession?.target_duration_seconds || 50 * 60;

  // Fetch active session and stats on mount
  useEffect(() => {
    if (!userId) return;

    cortexClient.getActiveFocusSession(userId).then((sess) => {
      if (sess) {
        setActiveSession(sess);
        setIntention(sess.intention);
        setRunning(true);
        // Calculate elapsed seconds since start
        const startTime = parseUTCDateTime(sess.started_at).getTime();
        const diffSecs = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
        const target = sess.target_duration_seconds || 50 * 60;
        setElapsed(Math.min(diffSecs, target));
        setDistractions({
          tabSwitch: sess.distraction_count,
          appSwap: sess.app_swaps || 0,
          idle: sess.idle_count || 0
        });
      }
    });

    cortexClient.getActivitySummary(userId).then((sum) => {
      if (sum.today) {
        setTodayStats({
          sessions: sum.today.sessions_count,
          focusMinutes: Math.round(sum.today.focus_seconds / 60)
        });
        setDistractions(prev => ({ ...prev, tabSwitch: sum.today?.distraction_count || 0 }));
      }
    });
  }, [userId]);

  // Update timer tick
  useEffect(() => {
    if (!running || !activeSession) return;
    const t = setInterval(() => {
      setElapsed((e) => {
        if (e >= total) {
          clearInterval(t);
          handleStop(true);
          return total;
        }
        return e + 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [running, activeSession, total]);

  // Sync distractions from backend every 5 seconds (low CPU polling)
  useEffect(() => {
    if (!running || !activeSession || !userId) return;
    const syncInterval = setInterval(() => {
      cortexClient.getActiveFocusSession(userId).then((sess) => {
        if (sess) {
          setDistractions({
            tabSwitch: sess.distraction_count,
            appSwap: sess.app_swaps || 0,
            idle: sess.idle_count || 0
          });
        }
      });
    }, 5000);
    return () => clearInterval(syncInterval);
  }, [running, activeSession, userId]);

  const handleStart = () => {
    if (!userId) return;
    cortexClient.startFocusSession(userId, intention, 50 * 60).then((sess) => {
      setActiveSession(sess);
      setRunning(true);
      setElapsed(0);
      setDistractions({ tabSwitch: 0, appSwap: 0, idle: 0 });
      
      if ((window as any).cortexAPI?.sendNotification) {
        (window as any).cortexAPI.sendNotification(
          "Focus Session Started",
          `Intention: "${intention}"`
        );
      }
    });
  };

  const handleStop = (completed = false) => {
    if (!activeSession) return;
    cortexClient.endFocusSession(activeSession.id, completed, distractions.tabSwitch).then(() => {
      if ((window as any).cortexAPI?.sendNotification) {
        if (completed) {
          (window as any).cortexAPI.sendNotification(
            "Focus Session Completed!",
            "Great job finishing your Pomodoro sprint. Take a break!"
          );
        } else {
          (window as any).cortexAPI.sendNotification(
            "Focus Session Paused",
            "Focus session has been stopped manually."
          );
        }
      }
      
      setActiveSession(null);
      setRunning(false);
      setElapsed(0);
      
      if (userId) {
        // Reload stats
        cortexClient.getActivitySummary(userId).then((sum) => {
          if (sum.today) {
            setTodayStats({
              sessions: sum.today.sessions_count,
              focusMinutes: Math.round(sum.today.focus_seconds / 60)
            });
          }
        });
      }
    });
  };


  const handleReset = () => {
    if (activeSession) {
      handleStop(false);
    } else {
      setElapsed(0);
    }
  };

  const remaining = total - elapsed;
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");
  const pct = elapsed / total;

  return (
    <AppLayout>
      <PageHeader
        title="Focus Session"
        description="Eliminate distractions. Cortex will guard your flow."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 relative overflow-hidden">
          <div
            className="absolute inset-0 opacity-40"
            style={{
              background:
                "radial-gradient(ellipse 70% 50% at 50% 100%, oklch(1 0 0 / 0.06), transparent 70%)",
            }}
          />
          <div className="relative grid place-items-center py-12">
            <div className="relative grid place-items-center">
              <motion.div
                animate={{ scale: running ? [1, 1.04, 1] : 1 }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                className="absolute inset-0 rounded-full"
                style={{
                  boxShadow: "0 0 120px 20px rgba(255,255,255,0.06)",
                }}
              />
              <svg viewBox="0 0 240 240" className="h-72 w-72 -rotate-90">
                <circle cx="120" cy="120" r="108" stroke="rgba(255,255,255,0.06)" strokeWidth="2" fill="none" />
                <circle
                  cx="120"
                  cy="120"
                  r="108"
                  stroke="white"
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 108}
                  strokeDashoffset={2 * Math.PI * 108 * (1 - pct)}
                />
              </svg>
              <div className="absolute inset-0 grid place-items-center">
                <div className="text-center">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">deep work</div>
                  <div className="mt-2 text-6xl font-semibold tabular-nums tracking-tight">
                    {mm}:{ss}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">50 min · single intention</div>
                </div>
              </div>
            </div>

            <div className="mt-10 flex gap-2">
              <Button onClick={running ? () => handleStop(false) : handleStart}>
                {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {running ? "Pause" : "Start session"}
              </Button>
              <Button variant="outline" onClick={handleReset}>
                <RotateCcw className="h-4 w-4" /> Reset
              </Button>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <div className="text-sm font-medium mb-3">Intention</div>
            <input
              value={intention}
              onChange={(e) => setIntention(e.target.value)}
              className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm outline-none focus:border-foreground/30"
              disabled={running}
            />
            <div className="mt-3 text-xs text-muted-foreground">
              Cortex will detect drift from this intent and gently nudge.
            </div>
          </Card>

          <Card>
            <div className="text-sm font-medium mb-3">Distractions</div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { l: "Tab switch", v: distractions.tabSwitch },
                { l: "App swap", v: distractions.appSwap },
                { l: "Idle", v: distractions.idle },
              ].map((d) => (
                <div key={d.l} className="rounded-md border border-border bg-surface-1 p-3">
                  <div className="text-xl font-semibold">{d.v}</div>
                  <div className="text-[11px] text-muted-foreground">{d.l}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div className="text-sm font-medium mb-3">Today</div>
            <div className="space-y-2 text-sm">
              <Row k="Sessions" v={`${todayStats.sessions} / 5`} />
              <Row k="Focus Time" v={`${todayStats.focusMinutes} min`} />
              <Row k="Avg session" v="50 min" />
            </div>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span>{v}</span>
    </div>
  );
}
