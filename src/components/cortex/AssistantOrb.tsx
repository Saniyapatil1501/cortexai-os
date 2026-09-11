import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

/**
 * Floating CortexAI presence orb. Persistent across the app.
 * Breathes calmly, toggles the side chat companion on click.
 */
export function AssistantOrb({
  isOpen,
  onToggle,
}: {
  isOpen: boolean;
  onToggle: () => void;
}) {
  const [state, setState] = useState<"idle" | "thinking" | "listening">("idle");

  // Tiny ambient state shifts
  useEffect(() => {
    const i = setInterval(() => {
      setState((s) => (s === "idle" ? "thinking" : "idle"));
    }, 9000);
    return () => clearInterval(i);
  }, []);

  if (isOpen) return null;

  return (
    <div className="fixed bottom-5 right-5 z-40 select-none font-sans">
      <button
        onClick={onToggle}
        aria-label="Cortex companion"
        className="relative grid h-12 w-12 place-items-center rounded-full border border-border bg-gradient-to-b from-surface-2 to-surface-1 cursor-pointer"
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
