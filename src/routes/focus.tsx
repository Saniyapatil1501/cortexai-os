import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Pause, Play, RotateCcw, Volume2 } from "lucide-react";
import { cortexClient, FocusSession } from "@/lib/api";
import { AppLayout } from "@/components/cortex/AppLayout";
import { Card, PageHeader, Button } from "@/components/cortex/ui";
import { motion } from "framer-motion";
import { useCortexAuth } from "@/hooks/useCortexAuth";
import { parseUTCDateTime } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/focus")({
  head: () => ({
    meta: [
      { title: "Focus — CortexAI" },
      {
        name: "description",
        content: "Immersive focus sessions with intelligent distraction tracking.",
      },
    ],
  }),
  component: FocusPage,
});

function FocusPage() {
  const { user } = useCortexAuth();
  const userId = user?.user_id;

  const [activeSession, setActiveSession] = useState<FocusSession | null>(null);
  const [intention, setIntention] = useState("Finish course assignments");
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0); // seconds
  const [distractions, setDistractions] = useState({ tabSwitch: 0, appSwap: 0, idle: 0 });
  const [todayStats, setTodayStats] = useState({ sessions: 0, focusMinutes: 0 });

  // Intelligent Context Classifier States
  const [activeState, setActiveState] = useState<string>("UNKNOWN");
  const [activeApp, setActiveApp] = useState<string>("System");
  const [activeTitle, setActiveTitle] = useState<string>("Desktop Idle");
  const [activeCategory, setActiveCategory] = useState<string>("unknown");
  const [activeReason, setActiveReason] = useState<string>("Unclear signals");

  // Proactive assistance & vision states
  const [showStuckPopup, setShowStuckPopup] = useState(false);
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const [stuckInfo, setStuckInfo] = useState<{ score: number; reason: string } | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [analysisPerformance, setAnalysisPerformance] = useState<{
    capture_time_ms: number;
    preprocessing_time_ms: number;
    ocr_time_ms: number;
    context_fusion_time_ms: number;
    genai_latency_ms: number;
    total_latency_ms: number;
  } | null>(null);
  const [screenTypeClassification, setScreenTypeClassification] = useState<string>("UNKNOWN");

  interface FocusSessionEventItem {
    state: string;
    duration: number;
    app_name?: string;
    window_title?: string;
    classification?: string;
    classification_reason?: string;
  }

  interface ContextItem {
    app: string;
    duration: number;
  }

  interface SessionAnalyticsItem {
    verified_focus_seconds: number;
    distraction_seconds: number;
    idle_seconds: number;
    unknown_seconds: number;
    total_duration_seconds: number;
    focus_percentage: number;
    pause_count: number;
    longest_focus_streak: number;
    longest_distraction: number;
    top_productive_contexts?: ContextItem[];
    top_distracting_contexts?: ContextItem[];
  }

  // Timeline State
  const [timelineEvents, setTimelineEvents] = useState<FocusSessionEventItem[]>([]);
  const [lastSessionAnalytics, setLastSessionAnalytics] = useState<SessionAnalyticsItem | null>(
    null,
  );

  // Total target duration
  const total = activeSession?.target_duration_seconds || 50 * 60;

  // Fetch active session and stats on mount
  useEffect(() => {
    if (!userId) return;

    cortexClient.getActiveFocusSession(userId).then((sess) => {
      if (sess) {
        setActiveSession(sess);
        setIntention(sess.intention);
        setRunning(true);
        setElapsed(sess.duration_seconds || 0);
        setDistractions({
          tabSwitch: sess.distraction_count || 0,
          appSwap: sess.app_swaps || 0,
          idle: sess.idle_count || 0,
        });

        // Pull initial timeline events
        cortexClient.getSessionTimeline(sess.id).then(setTimelineEvents).catch(console.error);
      }
    });

    cortexClient.getActivitySummary(userId).then((sum) => {
      if (sum.today) {
        setTodayStats({
          sessions: sum.today.sessions_count,
          focusMinutes: Math.round(sum.today.focus_seconds / 60),
        });
      }
    });
  }, [userId]);

  // Stuck detection evaluation interval (every 10 seconds)
  useEffect(() => {
    if (!running || !activeSession || !userId || dontAskAgain) return;

    const stuckTimer = setInterval(() => {
      cortexClient
        .checkStuckStatus(userId)
        .then((res) => {
          if (res.is_stuck) {
            setStuckInfo({ score: res.stuck_score, reason: res.trigger_reason });
            setShowStuckPopup(true);
          }
        })
        .catch(console.error);
    }, 10000);

    return () => clearInterval(stuckTimer);
  }, [running, activeSession, userId, dontAskAgain]);

  // Update timer tick locally from active session sync
  useEffect(() => {
    if (!running || !activeSession || !userId) return;

    const t = setInterval(() => {
      cortexClient.getActiveFocusSession(userId).then((sess) => {
        if (sess) {
          setElapsed(sess.duration_seconds || 0);
          setDistractions({
            tabSwitch: sess.distraction_count || 0,
            appSwap: sess.app_swaps || 0,
            idle: sess.idle_count || 0,
          });

          // Sync timeline events
          cortexClient.getSessionTimeline(sess.id).then(setTimelineEvents).catch(console.error);

          // Find the active segment from the last timeline event
          cortexClient.getSessionTimeline(sess.id).then((eventsList) => {
            if (eventsList && eventsList.length > 0) {
              const last = eventsList[eventsList.length - 1];
              setActiveState(last.state);
              setActiveApp(last.app_name || "System");
              setActiveTitle(last.window_title || "Study Session");
              setActiveCategory(last.classification || "unknown");
              setActiveReason(last.classification_reason || "Continuous updates");
            }
          });

          if (sess.duration_seconds >= total) {
            clearInterval(t);
            handleStop(true);
          }
        }
      });
    }, 2000); // Poll backend focus timer every 2 seconds for exact state alignment

    return () => clearInterval(t);
  }, [running, activeSession, userId, total]);

  const handleStart = () => {
    if (!userId) return;
    cortexClient.startFocusSession(userId, intention, 50 * 60).then((sess) => {
      setActiveSession(sess);
      setRunning(true);
      setElapsed(0);
      setLastSessionAnalytics(null);
      setDistractions({ tabSwitch: 0, appSwap: 0, idle: 0 });

      // Fetch initial timeline events
      cortexClient
        .getSessionTimeline(sess.id)
        .then((evts) => setTimelineEvents(evts as FocusSessionEventItem[]))
        .catch(console.error);

      const winObj = window as unknown as {
        cortexAPI?: { sendNotification?: (t: string, b: string) => void };
      };
      if (winObj.cortexAPI?.sendNotification) {
        winObj.cortexAPI.sendNotification(
          "Focus Session Started",
          `Goal target set: "${intention}"`,
        );
      }
    });
  };

  const handleStop = (completed = false) => {
    if (!activeSession) return;
    cortexClient
      .endFocusSession(activeSession.id, completed, distractions.tabSwitch)
      .then((analytics) => {
        const winObj = window as unknown as {
          cortexAPI?: { sendNotification?: (t: string, b: string) => void };
        };
        if (winObj.cortexAPI?.sendNotification) {
          if (completed) {
            winObj.cortexAPI.sendNotification(
              "Focus Target Completed!",
              "Great job finishing your productive study target!",
            );
          } else {
            winObj.cortexAPI.sendNotification(
              "Focus Session Stopped",
              "Focus session has been stopped manually.",
            );
          }
        }

        setLastSessionAnalytics(analytics);
        setActiveSession(null);
        setRunning(false);
        setElapsed(0);

        if (userId) {
          cortexClient.getActivitySummary(userId).then((sum) => {
            if (sum.today) {
              setTodayStats({
                sessions: sum.today.sessions_count,
                focusMinutes: Math.round(sum.today.focus_seconds / 60),
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
      setLastSessionAnalytics(null);
    }
  };

  const handleCorrect = (correctedLabel: string) => {
    if (!userId || !activeSession) return;
    cortexClient
      .submitFeedbackCorrection({
        user_id: userId,
        app_name: activeApp,
        window_title: activeTitle,
        study_goal: intention,
        predicted_label: activeCategory,
        corrected_label: correctedLabel,
      })
      .then(() => {
        toast.success(
          `Classification corrected to ${correctedLabel.toUpperCase()}. Cortex will adapt!`,
        );
      })
      .catch(console.error);
  };

  const triggerScreenAnalysis = () => {
    if (!userId || !activeSession) return;
    setIsAnalyzing(true);
    setAnalysisResult(null);
    setShowStuckPopup(false);

    cortexClient
      .analyzeScreen({
        user_id: userId,
        app_name: activeApp,
        window_title: activeTitle,
        study_goal: intention,
      })
      .then((res) => {
        setIsAnalyzing(false);
        if (res.status === "blocked") {
          toast.error("Screen analysis blocked for privacy reasons.");
        } else {
          setAnalysisResult(res.analysis);
          setAnalysisPerformance(res.performance);
          setScreenTypeClassification(res.screen_type);
          toast.success("Screen analyzed successfully!");
        }
      })
      .catch((err) => {
        setIsAnalyzing(false);
        toast.error(`Screen analysis failed: ${err.message || err}`);
      });
  };

  const remaining = Math.max(0, total - elapsed);
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");
  const pct = Math.min(1.0, elapsed / total);

  // Compute total timeline duration for rendering
  const timelineTotalSeconds = timelineEvents.reduce((acc, e) => acc + e.duration, 0) || 1;

  return (
    <AppLayout>
      <PageHeader
        title="Focus Session"
        description="Verified focus time tracking. Cortex validates your study goal context."
      />

      {showStuckPopup && (
        <Card className="border-rose-500/30 bg-rose-500/5 mb-4 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex justify-between items-start gap-4">
            <div>
              <h4 className="text-sm font-semibold text-rose-400">
                Proactive Assistance Triggered
              </h4>
              <p className="text-xs text-muted-foreground mt-1">
                Cortex detects you may be stuck (Stuck Score: {stuckInfo?.score}, Reason:{" "}
                {stuckInfo?.reason})
              </p>
              <p className="text-xs text-foreground/80 mt-2">
                Need help with what you're working on?
              </p>
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              <div className="flex gap-2">
                <Button
                  onClick={triggerScreenAnalysis}
                  className="bg-emerald-500 text-white hover:bg-emerald-600"
                >
                  Analyze & Help
                </Button>
                <Button variant="outline" onClick={() => setShowStuckPopup(false)}>
                  Not Now
                </Button>
              </div>
              <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground select-none cursor-pointer mt-1">
                <input
                  type="checkbox"
                  checked={dontAskAgain}
                  onChange={(e) => setDontAskAgain(e.target.checked)}
                  className="rounded border-border"
                />
                Don't ask again this session
              </label>
            </div>
          </div>
        </Card>
      )}

      {analysisResult && (
        <Card className="mb-4 border-blue-500/30">
          <div className="flex justify-between items-center border-b border-border/80 pb-3 mb-4">
            <div>
              <h3 className="text-base font-semibold text-blue-400 flex items-center gap-1.5">
                <span>Cortex Screen Insight Helper</span>
                <span className="text-[10px] bg-blue-500/10 border border-blue-500/25 text-blue-400 px-2 py-0.5 rounded font-normal uppercase tracking-wider">
                  Type: {screenTypeClassification}
                </span>
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Progressive tutoring guidance matching visible content
              </p>
            </div>
            <Button variant="outline" onClick={() => setAnalysisResult(null)}>
              Dismiss
            </Button>
          </div>

          <div className="space-y-4">
            <div className="text-sm leading-relaxed text-foreground select-text whitespace-pre-wrap font-sans bg-surface-2/40 border border-border/40 rounded-lg p-4 max-h-96 overflow-y-auto">
              {analysisResult}
            </div>

            {analysisPerformance && (
              <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-center text-[10px] text-muted-foreground pt-2.5 border-t border-border/40">
                <div>
                  <div className="font-semibold text-foreground">
                    {analysisPerformance.capture_time_ms}ms
                  </div>
                  <div>Capture</div>
                </div>
                <div>
                  <div className="font-semibold text-foreground">
                    {analysisPerformance.preprocessing_time_ms}ms
                  </div>
                  <div>Prep</div>
                </div>
                <div>
                  <div className="font-semibold text-foreground">
                    {analysisPerformance.ocr_time_ms}ms
                  </div>
                  <div>OCR</div>
                </div>
                <div>
                  <div className="font-semibold text-foreground">
                    {analysisPerformance.context_fusion_time_ms}ms
                  </div>
                  <div>Fusion</div>
                </div>
                <div>
                  <div className="font-semibold text-foreground">
                    {analysisPerformance.genai_latency_ms}ms
                  </div>
                  <div>GenAI</div>
                </div>
                <div>
                  <div className="font-semibold text-foreground text-blue-400">
                    {analysisPerformance.total_latency_ms}ms
                  </div>
                  <div>Total Latency</div>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 relative overflow-hidden flex flex-col justify-between py-8">
          <div
            className="absolute inset-0 opacity-40"
            style={{
              background:
                "radial-gradient(ellipse 70% 50% at 50% 100%, oklch(1 0 0 / 0.06), transparent 70%)",
            }}
          />
          <div className="relative grid place-items-center">
            <div className="relative grid place-items-center">
              <motion.div
                animate={{ scale: running ? [1, 1.03, 1] : 1 }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                className="absolute inset-0 rounded-full"
                style={{
                  boxShadow: "0 0 120px 20px rgba(255,255,255,0.06)",
                }}
              />
              <svg viewBox="0 0 240 240" className="h-64 w-64 -rotate-90">
                <circle
                  cx="120"
                  cy="120"
                  r="108"
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth="2"
                  fill="none"
                />
                <circle
                  cx="120"
                  cy="120"
                  r="108"
                  stroke="white"
                  strokeWidth="2.5"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 108}
                  strokeDashoffset={2 * Math.PI * 108 * (1 - pct)}
                />
              </svg>
              <div className="absolute inset-0 grid place-items-center">
                <div className="text-center">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    verified focus
                  </div>
                  <div className="mt-2 text-5xl font-bold tabular-nums tracking-tight">
                    {mm}:{ss}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Target: {Math.round(total / 60)} min
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 flex gap-2">
              <Button onClick={running ? () => handleStop(false) : handleStart}>
                {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {running ? "Stop session" : "Start session"}
              </Button>
              <Button variant="outline" onClick={handleReset}>
                <RotateCcw className="h-4 w-4" /> Reset
              </Button>
            </div>
          </div>

          {/* Timeline Visual color segmented bar */}
          {running && timelineEvents.length > 0 && (
            <div className="mt-8 px-6 space-y-2 select-none">
              <div className="text-xs font-semibold text-muted-foreground flex justify-between">
                <span>Study Timeline Stream</span>
                <span>
                  Verified focus: {Math.round(elapsed / 60)}m / {Math.round(total / 60)}m
                </span>
              </div>
              <div className="h-5 w-full rounded-md overflow-hidden bg-surface-3 flex border border-border/50">
                {timelineEvents.map((evt, idx) => {
                  const itemPct = (evt.duration / timelineTotalSeconds) * 100;
                  if (itemPct <= 0) return null;

                  let colorClass = "bg-neutral-500";
                  if (evt.state === "STUDY") colorClass = "bg-emerald-500";
                  else if (evt.state === "DISTRACTION") colorClass = "bg-rose-500";
                  else if (evt.state === "IDLE") colorClass = "bg-amber-500";
                  else if (evt.state === "UNKNOWN" || evt.state === "PENDING")
                    colorClass = "bg-blue-500";

                  return (
                    <div
                      key={idx}
                      className={`${colorClass} h-full transition-opacity hover:opacity-90`}
                      style={{ width: `${itemPct}%` }}
                      title={`${evt.state} | ${evt.app_name || "System"} | ${evt.duration}s`}
                    />
                  );
                })}
              </div>
              <div className="flex gap-4 justify-center text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded bg-emerald-500" /> Study
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded bg-rose-500" /> Distraction
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded bg-amber-500" /> Idle
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded bg-blue-500" /> Pending
                </span>
              </div>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <div className="text-sm font-medium mb-3">Study Intention Target</div>
            <input
              value={intention}
              onChange={(e) => setIntention(e.target.value)}
              className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm outline-none focus:border-foreground/30"
              disabled={running}
            />
            <div className="mt-3 text-xs text-muted-foreground">
              Cortex will analyze your active workspace context relative to this target.
            </div>
          </Card>

          {/* Active Context Classifier and Correction card */}
          {running && (
            <Card>
              <div className="flex items-center justify-between text-sm font-medium mb-3">
                <span>Active Context</span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded border ${
                    activeState === "STUDY"
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      : activeState === "DISTRACTION"
                        ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                        : activeState === "IDLE"
                          ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                          : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                  }`}
                >
                  {activeState}
                </span>
              </div>
              <div className="space-y-2 text-xs leading-relaxed font-sans">
                <div className="flex justify-between">
                  <span className="text-muted-foreground truncate w-20">App:</span>
                  <span className="font-semibold text-foreground truncate max-w-[150px]">
                    {activeApp}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground truncate w-20">Window:</span>
                  <span
                    className="font-semibold text-foreground truncate max-w-[150px]"
                    title={activeTitle}
                  >
                    {activeTitle}
                  </span>
                </div>
                <div className="pt-2 border-t border-border/40 text-[11px] leading-relaxed">
                  <span className="text-muted-foreground font-semibold">Signals: </span>
                  <span className="italic text-foreground/80">{activeReason}</span>
                </div>
                <div className="pt-2.5 flex justify-between items-center gap-1.5">
                  <Button
                    variant="outline"
                    onClick={triggerScreenAnalysis}
                    disabled={isAnalyzing}
                    className="text-[10px] py-1 border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                  >
                    {isAnalyzing ? "Analyzing..." : "Analyze Current Screen"}
                  </Button>
                  <div className="flex gap-1.5">
                    {activeCategory !== "study" ? (
                      <Button
                        variant="outline"
                        onClick={() => handleCorrect("study")}
                        className="text-[10px] py-1 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                      >
                        Mark as Study
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        onClick={() => handleCorrect("distraction")}
                        className="text-[10px] py-1 border-rose-500/30 text-rose-400 hover:bg-rose-500/10"
                      >
                        Mark as Distraction
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          )}

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

      {/* Post Session Summary Card */}
      {lastSessionAnalytics && (
        <div className="mt-4">
          <Card>
            <div className="flex justify-between items-center border-b border-border/80 pb-3 mb-4">
              <div>
                <h3 className="text-base font-semibold">Focus Session Completed</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Verified focus statistics calculations
                </p>
              </div>
              <Button variant="outline" onClick={() => setLastSessionAnalytics(null)}>
                Dismiss
              </Button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center select-none">
              <div className="rounded-lg bg-surface-2 border border-border/60 p-3.5">
                <div className="text-2xl font-bold text-emerald-400 tabular-nums">
                  {Math.round(lastSessionAnalytics.verified_focus_seconds / 60)}m{" "}
                  {lastSessionAnalytics.verified_focus_seconds % 60}s
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 uppercase tracking-wide">
                  Verified Focus
                </div>
              </div>
              <div className="rounded-lg bg-surface-2 border border-border/60 p-3.5">
                <div className="text-2xl font-bold text-rose-400 tabular-nums">
                  {Math.round(lastSessionAnalytics.distraction_seconds / 60)}m{" "}
                  {lastSessionAnalytics.distraction_seconds % 60}s
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 uppercase tracking-wide">
                  Distractions
                </div>
              </div>
              <div className="rounded-lg bg-surface-2 border border-border/60 p-3.5">
                <div className="text-2xl font-bold text-amber-400 tabular-nums">
                  {Math.round(lastSessionAnalytics.idle_seconds / 60)}m{" "}
                  {lastSessionAnalytics.idle_seconds % 60}s
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 uppercase tracking-wide">
                  Idle Time
                </div>
              </div>
              <div className="rounded-lg bg-surface-2 border border-border/60 p-3.5">
                <div className="text-2xl font-bold text-blue-400 tabular-nums">
                  {lastSessionAnalytics.focus_percentage}%
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 uppercase tracking-wide">
                  Focus Efficiency
                </div>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-8 text-sm">
              <div className="space-y-3">
                <div className="flex justify-between border-b border-border/30 pb-2">
                  <span className="text-muted-foreground">Wall-Clock Session Duration:</span>
                  <span className="font-mono">
                    {Math.round(lastSessionAnalytics.total_duration_seconds / 60)}m{" "}
                    {lastSessionAnalytics.total_duration_seconds % 60}s
                  </span>
                </div>
                <div className="flex justify-between border-b border-border/30 pb-2">
                  <span className="text-muted-foreground">Uncertain (Unknown) State:</span>
                  <span className="font-mono">
                    {Math.round(lastSessionAnalytics.unknown_seconds / 60)}m{" "}
                    {lastSessionAnalytics.unknown_seconds % 60}s
                  </span>
                </div>
                <div className="flex justify-between border-b border-border/30 pb-2">
                  <span className="text-muted-foreground">Longest Focus Streak:</span>
                  <span>
                    {Math.round(lastSessionAnalytics.longest_focus_streak / 60)}m{" "}
                    {lastSessionAnalytics.longest_focus_streak % 60}s
                  </span>
                </div>
                <div className="flex justify-between border-b border-border/30 pb-2">
                  <span className="text-muted-foreground">Longest Distraction Interval:</span>
                  <span>
                    {Math.round(lastSessionAnalytics.longest_distraction / 60)}m{" "}
                    {lastSessionAnalytics.longest_distraction % 60}s
                  </span>
                </div>
                <div className="flex justify-between pb-2">
                  <span className="text-muted-foreground">Confirmed Interruptions / Pauses:</span>
                  <span>{lastSessionAnalytics.pause_count} times</span>
                </div>
              </div>

              <div className="space-y-4">
                {lastSessionAnalytics.top_productive_contexts &&
                  lastSessionAnalytics.top_productive_contexts.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                        Top Productive Applications
                      </div>
                      <div className="space-y-1.5">
                        {lastSessionAnalytics.top_productive_contexts.map((c, idx) => (
                          <div
                            key={idx}
                            className="flex justify-between text-xs rounded bg-surface-2/40 px-3 py-1.5 border border-border/40"
                          >
                            <span className="truncate max-w-[180px]">{c.app}</span>
                            <span className="font-mono text-emerald-400 font-semibold">
                              {Math.round(c.duration / 60)}m {c.duration % 60}s
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                {lastSessionAnalytics.top_distracting_contexts &&
                  lastSessionAnalytics.top_distracting_contexts.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                        Top Distracting Applications
                      </div>
                      <div className="space-y-1.5">
                        {lastSessionAnalytics.top_distracting_contexts.map((c, idx) => (
                          <div
                            key={idx}
                            className="flex justify-between text-xs rounded bg-surface-2/40 px-3 py-1.5 border border-border/40"
                          >
                            <span className="truncate max-w-[180px]">{c.app}</span>
                            <span className="font-mono text-rose-400 font-semibold">
                              {Math.round(c.duration / 60)}m {c.duration % 60}s
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            </div>
          </Card>
        </div>
      )}
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
