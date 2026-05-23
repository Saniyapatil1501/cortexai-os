import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/cortex/AppLayout";
import { Card, PageHeader, Button } from "@/components/cortex/ui";
import { motion } from "framer-motion";
import { useEffect, useState, useRef } from "react";
import { Send, Mic, Sparkles, Plus, History, Square, Volume2, VolumeX } from "lucide-react";
import { cortexClient } from "@/lib/api";

export const Route = createFileRoute("/assistant")({
  head: () => ({
    meta: [
      { title: "AI Assistant — CortexAI" },
      { name: "description", content: "Talk to Cortex, your intelligent productivity copilot." },
    ],
  }),
  component: AssistantPage,
});

type Msg = { role: "user" | "ai"; text: string };

const initial: Msg[] = [
  { role: "ai", text: "Hey Alex — ready when you are. Want a summary of yesterday's focus blocks?" },
  { role: "user", text: "Yes, and tell me where I lost the most time." },
  {
    role: "ai",
    text:
      "Yesterday you logged 5h 48m of deep work across 6 sessions. Most context switching happened between 2:10 PM and 3:00 PM — three tab switches into Slack. Want me to mute notifications during that window today?",
  },
];

const prompts = [
  "Summarize my last study session",
  "Plan a 2-hour coding sprint",
  "What's hurting my focus this week?",
  "Draft a stand-up update",
];

function AssistantPage() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [recognition, setRecognition] = useState<any>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Load chat history on mount
  useEffect(() => {
    cortexClient.getChatHistory(1)
      .then((history) => {
        if (history && history.length > 0) {
          setMsgs(history.map((h) => ({ role: h.role === "user" ? "user" : "ai", text: h.content })));
        } else {
          setMsgs([
            { role: "ai", text: "Hey Alex — ready when you are. Ask me about your focus or activity logs!" }
          ]);
        }
      })
      .catch((err) => {
        console.error("Error loading chat history:", err);
        setMsgs([
          { role: "ai", text: "Hey Alex — ready when you are. Ask me about your focus or activity logs!" }
        ]);
      });
  }, []);

  // Auto scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, listening]);

  // Speech Recognition Setup
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = "en-US";

      rec.onstart = () => {
        setListening(true);
      };

      rec.onresult = (event: any) => {
        const text = event.results[0][0].transcript;
        if (text) {
          setInput(text);
          send(text, true);
        }
      };

      rec.onerror = (e: any) => {
        console.error("Speech recognition error:", e);
        setListening(false);
      };

      rec.onend = () => {
        setListening(false);
      };

      setRecognition(rec);
    }
  }, [voiceEnabled]);

  const toggleListening = () => {
    if (!recognition) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }
    if (listening) {
      recognition.stop();
    } else {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      setVoiceEnabled(true);
      recognition.start();
    }
  };

  const speakText = (text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    
    // Strip markdown formatting for cleaner speech synthesis
    const cleanText = text.replace(/[*_#`\-]/g, "").trim();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const naturalVoice = voices.find((v) => v.name.includes("Google US English") || v.lang.startsWith("en"));
    if (naturalVoice) {
      utterance.voice = naturalVoice;
    }
    window.speechSynthesis.speak(utterance);
  };

  const send = (text: string, playSpeech = false) => {
    if (!text.trim()) return;

    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    setMsgs((m) => [...m, { role: "user", text }, { role: "ai", text: "..." }]);
    setInput("");

    let streamingText = "";
    cortexClient.chatStream(1, text, (chunk) => {
      if (streamingText === "") {
        streamingText = chunk;
      } else {
        streamingText += chunk;
      }
      setMsgs((prev) => {
        const next = [...prev];
        if (next.length > 0 && next[next.length - 1].role === "ai") {
          next[next.length - 1] = { role: "ai", text: streamingText };
        }
        return next;
      });
    }).then(() => {
      if (playSpeech || voiceEnabled) {
        speakText(streamingText);
      }
    }).catch((err) => {
      console.error(err);
      setMsgs((prev) => {
        const next = [...prev];
        if (next.length > 0 && next[next.length - 1].role === "ai") {
          next[next.length - 1] = { role: "ai", text: "Error connecting to Cortex daemon. Make sure backend is running." };
        }
        return next;
      });
    });
  };

  const clearChat = () => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setMsgs([{ role: "ai", text: "New conversation started. Ask me anything!" }]);
  };

  return (
    <AppLayout>
      <PageHeader
        title="AI Assistant"
        description="Cortex understands your work patterns. Ask anything."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setVoiceEnabled(!voiceEnabled)}>
              {voiceEnabled ? <Volume2 className="h-4 w-4 mr-1 text-emerald-400" /> : <VolumeX className="h-4 w-4 mr-1 text-muted-foreground" />}
              {voiceEnabled ? "Voice On" : "Voice Off"}
            </Button>
            <Button variant="outline" onClick={clearChat}>
              <Plus className="h-4 w-4" /> New chat
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        <Card padded={false} className="hidden lg:flex flex-col">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm">
            <History className="h-4 w-4 text-muted-foreground" /> History
          </div>
          <div className="p-2 space-y-1">
            {[
              "Focus review · today",
              "Refactor plan · auth module",
              "Study plan · DS&A",
              "Weekly retrospective",
              "Reading list summary",
            ].map((t, i) => (
              <button
                key={i}
                className={`w-full rounded-md px-3 py-2 text-left text-sm transition ${
                  i === 0 ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:bg-surface-2/60"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </Card>

        <Card padded={false} className="flex flex-col h-[calc(100vh-220px)] min-h-[520px]">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <div className="flex items-center gap-2.5">
              <div className="relative h-8 w-8 grid place-items-center rounded-md border border-border bg-surface-2">
                <Sparkles className="h-4 w-4" />
                <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-card" />
              </div>
              <div>
                <div className="text-sm font-medium">Cortex</div>
                <div className="text-[11px] text-muted-foreground">Active · context aware</div>
              </div>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 scroll-fade-mask">
            {msgs.map((m, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-foreground text-background"
                      : "bg-surface-2 text-foreground border border-border"
                  }`}
                >
                  {m.text}
                </div>
              </motion.div>
            ))}
            {listening && (
              <div className="flex justify-center pt-2">
                <Waveform />
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Prompt suggestions */}
          <div className="border-t border-border px-4 py-2.5 flex flex-wrap gap-2">
            {prompts.map((p) => (
              <button
                key={p}
                onClick={() => send(p)}
                className="rounded-full border border-border bg-surface-1 px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-surface-2"
              >
                {p}
              </button>
            ))}
          </div>

          {/* Composer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-center gap-2 border-t border-border p-3"
          >
            <button
              type="button"
              onClick={toggleListening}
              className={`grid h-10 w-10 place-items-center rounded-md border transition ${
                listening
                  ? "border-foreground/60 bg-foreground text-background"
                  : "border-border bg-surface-1 text-muted-foreground hover:text-foreground"
              }`}
              aria-label="Voice"
            >
              {listening ? <Square className="h-4 w-4 animate-pulse" /> : <Mic className="h-4 w-4" />}
            </button>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Cortex anything…"
              className="flex-1 rounded-md border border-border bg-surface-1 px-3.5 py-2.5 text-sm outline-none focus:border-foreground/30"
            />
            <Button type="submit">
              <Send className="h-4 w-4" /> Send
            </Button>
          </form>
        </Card>
      </div>
    </AppLayout>
  );
}

function Waveform() {
  return (
    <div className="flex items-end gap-1 h-10">
      {Array.from({ length: 28 }).map((_, i) => (
        <motion.span
          key={i}
          className="w-0.5 rounded-full bg-foreground/80"
          animate={{ height: [4, 18 + (i % 5) * 4, 4] }}
          transition={{ duration: 0.9 + (i % 4) * 0.1, repeat: Infinity, ease: "easeInOut", delay: i * 0.04 }}
        />
      ))}
    </div>
  );
}
