import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/cortex/AppLayout";
import { Card, PageHeader, Button } from "@/components/cortex/ui";
import { motion } from "framer-motion";
import { useEffect, useState, useRef } from "react";
import { Send, Mic, Sparkles, Plus, History, Square, Volume2, VolumeX } from "lucide-react";
import { cortexClient } from "@/lib/api";
import { useCortexAuth } from "@/hooks/useCortexAuth";

export const Route = createFileRoute("/assistant")({
  head: () => ({
    meta: [
      { title: "AI Assistant — CortexAI" },
      { name: "description", content: "Talk to Cortex, your intelligent productivity copilot." },
    ],
  }),
  component: AssistantPage,
});

type Msg = {
  role: "user" | "ai";
  text: string;
  references?: { filename: string; page?: number; chunk?: number }[];
};

const modes = [
  { id: "general", label: "General", desc: "Productivity coach grounded in activity" },
  { id: "notes", label: "Ask Notes", desc: "Answers strictly from uploaded notes" },
  { id: "summarize", label: "Summarize", desc: "Document-level summarization" },
  { id: "quiz", label: "Quiz / MCQ", desc: "Generates interactive MCQ quizzes" },
  { id: "flashcards", label: "Flashcards", desc: "Generates quick review study cards" },
  { id: "viva", label: "Viva Prep", desc: "Prepares viva voce candidate questions" },
  { id: "coding", label: "Coding Coach", desc: "Tailored code help and algorithms" },
];

const prompts = [
  "Summarize my last study session",
  "Plan a 2-hour coding sprint",
  "What's hurting my focus this week?",
  "Draft a stand-up update",
];

function tryParseAIStructuredData(text: string) {
  let cleaned = text.trim();

  if (cleaned.includes("```")) {
    const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match && match[1]) {
      cleaned = match[1].trim();
    }
  }

  if (!cleaned.startsWith("[") && !cleaned.startsWith("{")) {
    const firstBrace = cleaned.indexOf("{");
    const firstBracket = cleaned.indexOf("[");

    if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
      const lastBracket = cleaned.lastIndexOf("]");
      if (lastBracket !== -1 && lastBracket > firstBracket) {
        cleaned = cleaned.substring(firstBracket, lastBracket + 1).trim();
      }
    } else if (firstBrace !== -1) {
      const lastBrace = cleaned.lastIndexOf("}");
      if (lastBrace !== -1 && lastBrace > firstBrace) {
        cleaned = cleaned.substring(firstBrace, lastBrace + 1).trim();
      }
    }
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      if (Array.isArray(parsed.questions)) return { type: "quiz", data: parsed.questions };
      if (Array.isArray(parsed.flashcards)) return { type: "flashcards", data: parsed.flashcards };
      if (parsed.question && parsed.options) return { type: "quiz", data: [parsed] };
      if (parsed.front && parsed.back) return { type: "flashcards", data: [parsed] };
    }
    if (Array.isArray(parsed) && parsed.length > 0) {
      if (parsed[0].question && parsed[0].options) return { type: "quiz", data: parsed };
      if (parsed[0].front && parsed[0].back) return { type: "flashcards", data: parsed };
    }
  } catch (e) {}
  return null;
}

function AssistantPage() {
  const { user } = useCortexAuth();
  const userId = user?.user_id;
  const displayName = user?.first_name || "";

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [historyItems, setHistoryItems] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [recognition, setRecognition] = useState<any>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const lastLoadedUserId = useRef<number | null>(null);

  const [selectedMode, setSelectedMode] = useState<string>("general");
  const [selectedDocId, setSelectedDocId] = useState<string>("all");
  const [documents, setDocuments] = useState<any[]>([]);
  const [isOllamaOffline, setIsOllamaOffline] = useState(false);

  // Check Ollama connection on mount
  useEffect(() => {
    cortexClient
      .getAssistantHealth()
      .then((res) => {
        setIsOllamaOffline(res.status === "offline");
      })
      .catch(() => {
        setIsOllamaOffline(true);
      });
  }, []);

  // Load chat history on mount and handle pending prompts
  useEffect(() => {
    if (!userId || lastLoadedUserId.current === userId) return;

    lastLoadedUserId.current = userId;
    cortexClient
      .getChatHistory(userId)
      .then((history) => {
        let initialMsgs: Msg[] = [];
        if (history && history.length > 0) {
          initialMsgs = history.map((h) => ({
            role: h.role === "user" ? "user" : "ai",
            text: h.content,
          }));

          // Dynamically compute unique past user questions for the history list
          const userPrompts = history
            .filter((h) => h.role === "user")
            .map((h) => h.content)
            .filter((val, idx, self) => self.indexOf(val) === idx);
          setHistoryItems(userPrompts.slice(-5).reverse());
        } else {
          initialMsgs = [
            {
              role: "ai",
              text: `Hey ${displayName || "there"} — ready when you are. Ask me about your focus or activity logs!`,
            },
          ];
          setHistoryItems([]);
        }

        // Check for search bar auto-prompt
        const pendingPrompt = sessionStorage.getItem("cortex_auto_prompt");
        if (pendingPrompt) {
          sessionStorage.removeItem("cortex_auto_prompt");
          setMsgs([
            ...initialMsgs,
            { role: "user", text: pendingPrompt },
            { role: "ai", text: "..." },
          ]);

          setHistoryItems((prev) => {
            const next = [pendingPrompt, ...prev.filter((p) => p !== pendingPrompt)];
            return next.slice(0, 5);
          });

          let streamingText = "";
          cortexClient
            .chatStream(userId, pendingPrompt, "general", "all", (chunk) => {
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
            })
            .catch((err) => {
              console.error(err);
              setMsgs((prev) => {
                const next = [...prev];
                if (next.length > 0 && next[next.length - 1].role === "ai") {
                  next[next.length - 1] = {
                    role: "ai",
                    text: "AI model is currently unavailable. Please check if local Ollama is running.",
                  };
                }
                return next;
              });
            });
        } else {
          setMsgs(initialMsgs);
        }
      })
      .catch((err) => {
        console.error("Error loading chat history:", err);
        setMsgs([
          {
            role: "ai",
            text: `Hey ${displayName || "there"} — ready when you are. Ask me about your focus or activity logs!`,
          },
        ]);
        setHistoryItems([]);
      });
  }, [userId, displayName]);

  // Load documents on mount
  useEffect(() => {
    if (userId) {
      cortexClient.getDocuments(userId).then(setDocuments).catch(console.error);
    }
  }, [userId]);

  // Auto scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, listening]);

  // Listen for orb custom prompts
  useEffect(() => {
    if (!userId) return;

    const handlePromptEvent = (e: Event) => {
      const customPrompt = (e as CustomEvent).detail;
      if (customPrompt) {
        send(customPrompt);
      }
    };

    window.addEventListener("cortex:prompt", handlePromptEvent);
    return () => {
      window.removeEventListener("cortex:prompt", handlePromptEvent);
    };
  }, [userId]);

  // Speech Recognition Setup
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
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
    const naturalVoice = voices.find(
      (v) => v.name.includes("Google US English") || v.lang.startsWith("en"),
    );
    if (naturalVoice) {
      utterance.voice = naturalVoice;
    }
    window.speechSynthesis.speak(utterance);
  };

  const send = (text: string, playSpeech = false) => {
    if (!text.trim() || !userId) return;

    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    setMsgs((m) => [...m, { role: "user", text }, { role: "ai", text: "..." }]);
    setInput("");

    setHistoryItems((prev) => {
      const next = [text, ...prev.filter((p) => p !== text)];
      return next.slice(0, 5);
    });

    let streamingText = "";
    let currentRefs: { filename: string; page?: number; chunk?: number }[] = [];

    cortexClient
      .chatStream(
        userId,
        text,
        selectedMode,
        selectedDocId,
        (chunk) => {
          if (chunk === "OLLAMA_OFFLINE") {
            setIsOllamaOffline(true);
            setMsgs((prev) => {
              const next = [...prev];
              if (next.length > 0 && next[next.length - 1].role === "ai") {
                next[next.length - 1] = {
                  role: "ai",
                  text: "OLLAMA_OFFLINE",
                };
              }
              return next;
            });
            return;
          }
          if (streamingText === "") {
            streamingText = chunk;
          } else {
            streamingText += chunk;
          }
          setMsgs((prev) => {
            const next = [...prev];
            if (next.length > 0 && next[next.length - 1].role === "ai") {
              next[next.length - 1] = {
                role: "ai",
                text: streamingText,
                references: currentRefs.length > 0 ? currentRefs : undefined,
              };
            }
            return next;
          });
        },
        (refs) => {
          currentRefs = refs;
          setMsgs((prev) => {
            const next = [...prev];
            if (next.length > 0 && next[next.length - 1].role === "ai") {
              next[next.length - 1] = {
                ...next[next.length - 1],
                references: refs,
              };
            }
            return next;
          });
        },
      )
      .then(() => {
        if (playSpeech || voiceEnabled) {
          speakText(streamingText);
        }
      })
      .catch((err) => {
        console.error(err);
        setIsOllamaOffline(true);
        setMsgs((prev) => {
          const next = [...prev];
          if (next.length > 0 && next[next.length - 1].role === "ai") {
            next[next.length - 1] = {
              role: "ai",
              text: "OLLAMA_OFFLINE",
            };
          }
          return next;
        });
      });
  };

  const clearChat = () => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (userId) {
      cortexClient
        .clearChatHistory(userId)
        .then(() => {
          setMsgs([{ role: "ai", text: "New conversation started. Ask me anything!" }]);
          setHistoryItems([]);
        })
        .catch((err) => {
          console.error("Failed to clear chat history in backend:", err);
          setMsgs([{ role: "ai", text: "New conversation started. Ask me anything!" }]);
          setHistoryItems([]);
        });
    } else {
      setMsgs([{ role: "ai", text: "New conversation started. Ask me anything!" }]);
      setHistoryItems([]);
    }
  };

  return (
    <AppLayout>
      <PageHeader
        title="AI Assistant"
        description="Cortex understands your work patterns. Ask anything."
        actions={
          !isOllamaOffline && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setVoiceEnabled(!voiceEnabled)}>
                {voiceEnabled ? (
                  <Volume2 className="h-4 w-4 mr-1 text-emerald-400" />
                ) : (
                  <VolumeX className="h-4 w-4 mr-1 text-muted-foreground" />
                )}
                {voiceEnabled ? "Voice On" : "Voice Off"}
              </Button>
              <Button variant="outline" onClick={clearChat}>
                <Plus className="h-4 w-4" /> New chat
              </Button>
            </div>
          )
        }
      />

      {isOllamaOffline ? (
        <OllamaSetupWizard onRetry={() => setIsOllamaOffline(false)} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
          <Card padded={false} className="hidden lg:flex flex-col">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm">
              <History className="h-4 w-4 text-muted-foreground" /> History
            </div>
            <div className="p-2 space-y-1 overflow-y-auto max-h-[350px]">
              {historyItems.length > 0 ? (
                historyItems.map((t, i) => (
                  <button
                    key={i}
                    onClick={() => send(t)}
                    className="w-full rounded-md px-3 py-2 text-left text-sm transition text-muted-foreground hover:bg-surface-2/60 hover:text-foreground truncate block cursor-pointer"
                    title={t}
                  >
                    {t}
                  </button>
                ))
              ) : (
                <div className="text-xs text-muted-foreground p-4 text-center select-none">
                  No past questions yet. Ask something to see history!
                </div>
              )}
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

            {/* Chat Modes selector row */}
            <div className="flex flex-wrap gap-1 border-b border-border bg-surface-2/15 p-2 shrink-0 overflow-x-auto select-none">
              {modes.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setSelectedMode(m.id);
                    if (msgs.length === 1 && msgs[0].text.startsWith("Hey ")) {
                      setMsgs([
                        {
                          role: "ai",
                          text: `Switched to ${m.label} mode. Ready for your study queries!`,
                        },
                      ]);
                    }
                  }}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition cursor-pointer shrink-0 ${
                    selectedMode === m.id
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                  }`}
                  title={m.desc}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* RAG Context selectors if applicable */}
            {["notes", "summarize", "quiz", "flashcards", "viva"].includes(selectedMode) && (
              <div className="flex items-center gap-2 border-b border-border bg-surface-2/5 p-2 px-4 shrink-0 text-xs text-muted-foreground select-none">
                <span className="font-medium">Selected Resource:</span>
                <select
                  value={selectedDocId}
                  onChange={(e) => setSelectedDocId(e.target.value)}
                  className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-xs text-foreground outline-none cursor-pointer focus:border-foreground/30"
                >
                  <option value="all">All Uploaded Material</option>
                  {documents
                    .filter((d) => d.status === "ready")
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.original_filename}
                      </option>
                    ))}
                </select>
                {selectedMode === "summarize" && selectedDocId === "all" && (
                  <span className="text-[10px] text-amber-400 font-sans ml-2">
                    Note: select a specific file to summarize it fully.
                  </span>
                )}
              </div>
            )}

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
                    className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      m.role === "user"
                        ? "bg-foreground text-background whitespace-pre-wrap"
                        : "bg-surface-2 text-foreground border border-border"
                    }`}
                  >
                    {(() => {
                      if (m.role === "ai" && m.text === "OLLAMA_OFFLINE") {
                        return <OllamaSetupWizard onRetry={() => setIsOllamaOffline(false)} />;
                      }
                      if (m.role === "ai") {
                        const parsedData = tryParseAIStructuredData(m.text);
                        if (parsedData) {
                          if (parsedData.type === "quiz") {
                            return <InteractiveQuiz data={parsedData.data} />;
                          }
                          if (parsedData.type === "flashcards") {
                            return <FlashcardList data={parsedData.data} />;
                          }
                        }
                      }
                      return <p className="whitespace-pre-wrap select-text font-sans">{m.text}</p>;
                    })()}

                    {/* Document references citations */}
                    {m.role === "ai" && m.references && m.references.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/40 pt-2.5 text-[11px] text-muted-foreground select-none">
                        <span className="font-semibold mr-1">Sources:</span>
                        {m.references.map((ref, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-3 border border-border/60 text-[10px]"
                            title={`Chunk index: ${ref.chunk !== undefined ? ref.chunk + 1 : 1}`}
                          >
                            📄 {ref.filename} {ref.page ? `· Page ${ref.page}` : ""}
                          </span>
                        ))}
                      </div>
                    )}
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
                  className="rounded-full border border-border bg-surface-1 px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-surface-2 cursor-pointer transition"
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
                className={`grid h-10 w-10 place-items-center rounded-md border transition cursor-pointer ${
                  listening
                    ? "border-foreground/60 bg-foreground text-background"
                    : "border-border bg-surface-1 text-muted-foreground hover:text-foreground"
                }`}
                aria-label="Voice"
              >
                {listening ? (
                  <Square className="h-4 w-4 animate-pulse" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </button>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  selectedMode === "summarize"
                    ? "Click Send to summarize selected file..."
                    : selectedMode === "quiz"
                      ? "Ask to generate a quiz, or click Send to generate from notes..."
                      : selectedMode === "flashcards"
                        ? "Ask to generate cards, or click Send to create..."
                        : "Ask Cortex anything..."
                }
                className="flex-1 rounded-md border border-border bg-surface-1 px-3.5 py-2.5 text-sm outline-none focus:border-foreground/30"
              />
              <Button type="submit">
                <Send className="h-4 w-4" /> Send
              </Button>
            </form>
          </Card>
        </div>
      )}
    </AppLayout>
  );
}

interface QuizItem {
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string;
}

function InteractiveQuiz({ data }: { data: QuizItem[] }) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});

  return (
    <div className="space-y-4 my-2">
      {data.map((q, idx) => {
        const isCorrect = answers[idx] === q.correct_answer;
        const hasSubmitted = revealed[idx];

        return (
          <div
            key={idx}
            className="rounded-xl border border-border bg-surface-1/40 p-4 space-y-3 shadow-sm select-text"
          >
            <div className="font-semibold text-[10px] text-muted-foreground tracking-wider uppercase">
              Question {idx + 1} of {data.length}
            </div>
            <div className="text-sm font-semibold text-foreground leading-relaxed">
              {q.question}
            </div>

            <div className="grid grid-cols-1 gap-2">
              {q.options.map((opt: string) => {
                const isSelected = answers[idx] === opt;
                let optStyle = "border-border/60 hover:bg-surface-3 hover:text-foreground";
                if (hasSubmitted) {
                  if (opt === q.correct_answer) {
                    optStyle =
                      "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 font-semibold";
                  } else if (isSelected) {
                    optStyle = "border-rose-500/40 bg-rose-500/10 text-rose-400";
                  } else {
                    optStyle = "opacity-50 border-border/30";
                  }
                } else if (isSelected) {
                  optStyle = "border-foreground bg-foreground text-background";
                }

                return (
                  <button
                    key={opt}
                    disabled={hasSubmitted}
                    onClick={() => setAnswers((prev) => ({ ...prev, [idx]: opt }))}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition cursor-pointer ${optStyle}`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>

            {!hasSubmitted && answers[idx] && (
              <Button
                onClick={() => setRevealed((prev) => ({ ...prev, [idx]: true }))}
                className="w-full text-[11px] py-1.5 justify-center mt-1 cursor-pointer"
              >
                Submit Answer
              </Button>
            )}

            {hasSubmitted && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-xs border-t border-border/40 pt-2.5 space-y-1"
              >
                <div className="flex items-center gap-1.5 font-semibold">
                  {isCorrect ? (
                    <span className="text-emerald-400">✓ Correct</span>
                  ) : (
                    <span className="text-rose-400">
                      ✗ Incorrect (Correct Answer: {q.correct_answer})
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground leading-relaxed font-sans">{q.explanation}</p>
              </motion.div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface FlashcardItem {
  front: string;
  back: string;
}

function FlashcardList({ data }: { data: FlashcardItem[] }) {
  const [flipped, setFlipped] = useState<Record<number, boolean>>({});

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-2">
      {data.map((card, idx) => {
        const isFlipped = flipped[idx];

        return (
          <div
            key={idx}
            onClick={() => setFlipped((prev) => ({ ...prev, [idx]: !prev[idx] }))}
            className="group relative h-36 w-full rounded-xl border border-border bg-surface-1/40 hover:border-foreground/20 cursor-pointer shadow-sm overflow-hidden [perspective:1000px] select-none transition-all duration-300 active:scale-[0.98]"
          >
            <div
              className={`relative h-full w-full transition-all duration-500 [transform-style:preserve-3d] ${
                isFlipped ? "[transform:rotateY(180deg)]" : ""
              }`}
            >
              {/* Front Side */}
              <div className="absolute inset-0 flex flex-col p-4 [backface-visibility:hidden] justify-between">
                <span className="text-[10px] font-semibold text-muted-foreground tracking-wider uppercase">
                  Card {idx + 1}
                </span>
                <p className="text-sm font-semibold text-foreground text-center my-auto leading-relaxed line-clamp-3">
                  {card.front}
                </p>
                <span className="text-[9px] text-muted-foreground text-center">Click to flip</span>
              </div>

              {/* Back Side */}
              <div className="absolute inset-0 flex flex-col p-4 bg-surface-2 [backface-visibility:hidden] [transform:rotateY(180deg)] justify-between">
                <span className="text-[10px] font-semibold text-muted-foreground tracking-wider uppercase">
                  Answer
                </span>
                <p className="text-xs text-foreground/90 text-center my-auto leading-relaxed overflow-y-auto max-h-[70px] px-1 font-sans">
                  {card.back}
                </p>
                <span className="text-[9px] text-muted-foreground text-center">
                  Click to flip back
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
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
          transition={{
            duration: 0.9 + (i % 4) * 0.1,
            repeat: Infinity,
            ease: "easeInOut",
            delay: i * 0.04,
          }}
        />
      ))}
    </div>
  );
}

function OllamaSetupWizard({ onRetry }: { onRetry: () => void }) {
  const [checking, setChecking] = useState(false);

  const handleCheck = async () => {
    setChecking(true);
    try {
      const res = await cortexClient.getAssistantHealth();
      if (res.status === "ok") {
        onRetry();
      } else {
        alert("Ollama is still offline. Please check that the application is running.");
      }
    } catch {
      alert("Failed to reach backend server.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-6 max-w-xl mx-auto space-y-4 my-6 text-foreground select-text">
      <div className="flex items-center gap-3 border-b border-border/40 pb-3">
        <div className="h-8 w-8 rounded-full bg-amber-500/10 grid place-items-center text-amber-400">
          ⚠️
        </div>
        <div>
          <h3 className="text-sm font-semibold">Local AI Model Offline</h3>
          <p className="text-xs text-muted-foreground">
            Follow these simple steps to set up your productivity copilot.
          </p>
        </div>
      </div>

      <div className="space-y-3.5 text-xs text-muted-foreground">
        <div className="flex gap-3">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[10px] font-semibold text-foreground">
            1
          </span>
          <div>
            <p className="font-semibold text-foreground">Download Ollama</p>
            <p>Download and install Ollama for Windows from the official site.</p>
            <a
              href="https://ollama.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-1.5 rounded-md bg-foreground text-background px-3 py-1.5 text-[10px] font-medium hover:opacity-90 cursor-pointer"
            >
              Go to Ollama.com
            </a>
          </div>
        </div>

        <div className="flex gap-3">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[10px] font-semibold text-foreground">
            2
          </span>
          <div>
            <p className="font-semibold text-foreground">Pull Qwen Coder Model</p>
            <p>Open command prompt / terminal and run the model pull command:</p>
            <code className="block mt-1.5 rounded bg-surface-3 p-2 text-[10px] text-emerald-400 font-mono select-all">
              ollama pull qwen2.5-coder:3b
            </code>
          </div>
        </div>

        <div className="flex gap-3">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[10px] font-semibold text-foreground">
            3
          </span>
          <div>
            <p className="font-semibold text-foreground">Launch Service</p>
            <p>Ensure the Ollama application is running in your system tray.</p>
          </div>
        </div>
      </div>

      <div className="pt-2 border-t border-border/40 flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={handleCheck}
          disabled={checking}
          className="text-xs py-1.5 cursor-pointer"
        >
          {checking ? "Checking connection..." : "Retry Connection"}
        </Button>
      </div>
    </div>
  );
}
