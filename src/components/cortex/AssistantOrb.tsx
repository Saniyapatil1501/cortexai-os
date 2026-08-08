import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, Mic } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

/**
 * Floating CortexAI presence orb. Persistent across the app.
 * Breathes calmly, expands into a quick command panel on click.
 */
export function AssistantOrb() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "thinking" | "listening">("idle");

  // tiny ambient state shifts
  useEffect(() => {
    const i = setInterval(() => {
      setState((s) => (s === "idle" ? "thinking" : "idle"));
    }, 9000);
    return () => clearInterval(i);
  }, []);

  const handleAction = (promptText: string) => {
    setOpen(false);
    sessionStorage.setItem("cortex_auto_prompt", promptText);
    navigate({ to: "/assistant" });
    window.dispatchEvent(new CustomEvent("cortex:prompt", { detail: promptText }));
  };

  return (
    <div className="fixed bottom-5 right-5 z-40 select-none">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ type: "spring", damping: 24, stiffness: 280 }}
            className="absolute bottom-16 right-0 w-72 rounded-xl border border-border bg-popover/90 backdrop-blur-xl p-3 shadow-2xl"
            style={{
              boxShadow: "0 20px 60px -20px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.04)",
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-3.5 w-3.5" /> Cortex presence
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="text-xs text-muted-foreground mb-3">
              {state === "thinking"
                ? "Analyzing your context…"
                : state === "listening"
                  ? "Listening…"
                  : "Ready when you are."}
            </div>
            <div className="space-y-1">
              {["Summarize current focus", "Plan the next 90 minutes", "Mute distractions"].map(
                (t) => (
                  <button
                    key={t}
                    onClick={() => handleAction(t)}
                    className="w-full rounded-md px-3 py-2 text-left text-xs text-muted-foreground hover:bg-surface-2 hover:text-foreground transition cursor-pointer"
                  >
                    {t}
                  </button>
                ),
              )}
            </div>
            <div className="mt-2 flex gap-2 border-t border-border pt-2">
              <button
                onClick={() => handleAction("Activate voice dictation")}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-surface-1 px-2 py-1.5 text-xs hover:bg-surface-2 cursor-pointer"
              >
                <Mic className="h-3 w-3" /> Voice
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Cortex assistant"
        className="relative grid h-12 w-12 place-items-center rounded-full border border-border bg-gradient-to-b from-surface-2 to-surface-1"
        style={{
          boxShadow: "0 12px 40px -8px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06)",
        }}
      >
        {/* outer breathing rings */}
        <motion.span
          className="absolute inset-0 rounded-full border border-foreground/15"
          animate={{ scale: [1, 1.25, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.span
          className="absolute inset-0 rounded-full border border-foreground/10"
          animate={{ scale: [1, 1.5, 1], opacity: [0.4, 0, 0.4] }}
          transition={{ duration: 4.6, repeat: Infinity, ease: "easeInOut", delay: 0.6 }}
        />
        {/* core */}
        <motion.span
          className="block h-3.5 w-3.5 rounded-full bg-foreground"
          animate={
            state === "thinking"
              ? { scale: [1, 1.15, 0.9, 1.1, 1], opacity: [1, 0.7, 1, 0.8, 1] }
              : state === "listening"
                ? { scale: [1, 1.25, 1] }
                : { scale: [1, 1.06, 1], opacity: [0.9, 1, 0.9] }
          }
          transition={{
            duration: state === "thinking" ? 1.4 : state === "listening" ? 0.8 : 3,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
        {/* status dot */}
        <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-background" />
      </button>
    </div>
  );
}
