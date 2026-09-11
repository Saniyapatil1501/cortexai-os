import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { Send, X, Minimize2, Sparkles, AlertCircle, Play, Camera } from "lucide-react";
import { cortexClient } from "@/lib/api";
import { parseUTCDateTime } from "@/lib/utils";
import { useCortexAuth } from "@/hooks/useCortexAuth";

export const Route = createFileRoute("/companion-widget")({
  component: CompanionWidgetPage,
});

type CompanionState = "idle" | "listening" | "thinking" | "answering" | "focus" | "warning" | "sleeping";

type Msg = {
  role: "user" | "ai";
  text: string;
};

function CompanionWidgetPage() {
  const {
    user,
    activeSession,
    activeApp,
    activeState: contextActiveState,
    activeTitle,
    activeReason,
  } = useCortexAuth();

  const [expanded, setExpanded] = useState(false);
  const [companionState, setCompanionState] = useState<CompanionState>("idle");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [activeState, setActiveState] = useState<string>("IDLE");
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const userIdRef = useRef<number | null>(null);
  const [lensPreview, setLensPreview] = useState<string | null>(null);
  const [lensLoading, setLensLoading] = useState(false);

  // Sync ref with context user
  useEffect(() => {
    if (user?.user_id) {
      userIdRef.current = user.user_id;
    } else {
      userIdRef.current = null;
    }
  }, [user?.user_id]);

  // Sync activeState with context activeState
  useEffect(() => {
    if (contextActiveState) {
      setActiveState(contextActiveState);
    }
  }, [contextActiveState]);

  // Initial load and listeners
  useEffect(() => {
    // Context Action listener
    if ((window as any).cortexAPI?.onCompanionAction) {
      (window as any).cortexAPI.onCompanionAction((action: string) => {
        if (action === "expand-chat") {
          setExpanded(true);
          if ((window as any).cortexAPI?.resizeCompanionWidget) {
            (window as any).cortexAPI.resizeCompanionWidget(true);
          }
        }
      });
    }
  }, []);

  // Sync chat history
  useEffect(() => {
    const userId = user?.user_id;
    if (!userId || userId === -1) {
      setMsgs([]);
      return;
    }

    const syncChat = () => {
      cortexClient.getChatHistory(userId).then((history) => {
        if (history && history.length > 0) {
          setMsgs((prev) => {
            if (prev.length !== history.length) {
              return history.map((h) => ({
                role: h.role === "user" ? ("user" as const) : ("ai" as const),
                text: h.content,
              }));
            }
            return prev;
          });
        }
      }).catch(console.error);
    };

    syncChat();
    const syncInterval = setInterval(syncChat, 5000);
    return () => clearInterval(syncInterval);
  }, [user?.user_id]);

  // Scroll to bottom on expansion or new messages
  useEffect(() => {
    if (expanded) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [expanded, msgs]);

  // Sync state machine mapping
  useEffect(() => {
    if (companionState === "thinking" || companionState === "answering") {
      return; // Keep priority processing animations active
    }

    if (activeSession) {
      if (activeState === "DISTRACTION") {
        setCompanionState("warning");
      } else {
        setCompanionState("focus");
      }
    } else {
      // If late night, show sleeping, else idle
      const hr = new Date().getHours();
      if (hr >= 23 || hr < 6) {
        setCompanionState("sleeping");
      } else {
        setCompanionState("idle");
      }
    }
  }, [activeSession, activeState]);

  const toggleExpand = () => {
    const nextState = !expanded;
    setExpanded(nextState);
    if ((window as any).cortexAPI?.resizeCompanionWidget) {
      (window as any).cortexAPI.resizeCompanionWidget(nextState);
    }
  };

  const handleMinimize = () => {
    setExpanded(false);
    if ((window as any).cortexAPI?.resizeCompanionWidget) {
      (window as any).cortexAPI.resizeCompanionWidget(false);
    }
  };

  const handleClose = () => {
    if ((window as any).cortexAPI?.hideCompanionWidget) {
      (window as any).cortexAPI.hideCompanionWidget();
    }
  };

  const send = async (textToSend: string) => {
    if (!textToSend.trim() || !userIdRef.current) return;
    setInput("");
    
    // User bubble
    const userMsg: Msg = { role: "user", text: textToSend };
    setMsgs((prev) => [...prev, userMsg]);
    setCompanionState("thinking");

    const query = textToSend.toLowerCase().trim();

    // 1. "Open CortexAI"
    if (query.includes("open cortexai") || query.includes("open main window")) {
      setTimeout(() => {
        setCompanionState("answering");
        setMsgs((prev) => [...prev, { role: "ai", text: "Understood. Opening the main CortexAI dashboard window..." }]);
        setTimeout(() => {
          if ((window as any).cortexAPI?.hideCompanionWidget) {
            (window as any).cortexAPI.hideCompanionWidget();
          }
          setCompanionState("idle");
        }, 1000);
      }, 500);
      return;
    }

    // 2. "Use Lens" or "Explain what's on my screen"
    if (query.includes("use lens") || query.includes("open lens") || query.includes("explain what's on my screen")) {
      setTimeout(() => {
        setCompanionState("answering");
        setMsgs((prev) => [...prev, { role: "ai", text: "Opening Lens screen crop capture. Select any region of your screen to analyze." }]);
        setTimeout(() => {
          handleLensTrigger();
          setCompanionState("idle");
        }, 1200);
      }, 500);
      return;
    }

    // 3. "Start a X minute focus session"
    const focusMatch = query.match(/start\s+(?:a\s+)?(\d+)\s*minute\s+focus\s+session/i);
    if (focusMatch) {
      const minutes = parseInt(focusMatch[1], 10);
      try {
        await cortexClient.startFocusSession(userIdRef.current, "Cortex Companion Sprint", minutes * 60);
        setTimeout(() => {
          setCompanionState("answering");
          setMsgs((prev) => [
            ...prev,
            { role: "ai", text: `Success! Started a ${minutes}-minute Focus session with target: "Cortex Companion Sprint".` }
          ]);
          // Dispatch focus start triggers
          window.dispatchEvent(new CustomEvent("cortex:focus-started"));
          setTimeout(() => {
            setCompanionState("focus");
          }, 1000);
        }, 800);
      } catch (err) {
        setMsgs((prev) => [...prev, { role: "ai", text: "Failed to start focus session: " + String(err) }]);
        setCompanionState("idle");
      }
      return;
    }

    // 4. "What am I working on?"
    if (query.includes("what am i working on") || query.includes("current focus")) {
      setTimeout(() => {
        setCompanionState("answering");
        const appText = activeApp && activeApp !== "System" ? `using ${activeApp}` : "";
        const reply = activeSession
          ? `You are currently in an active Focus session for: "${activeSession.intention}" ${appText}.`
          : "You don't have an active Focus session right now. You can start one by asking: 'Start a 25 minute focus session'.";
        setMsgs((prev) => [...prev, { role: "ai", text: reply }]);
        setTimeout(() => {
          setCompanionState(activeSession ? "focus" : "idle");
        }, 1000);
      }, 500);
      return;
    }

    // 5. "What did I do today?"
    if (query.includes("what did i do today") || query.includes("summary of today")) {
      try {
        const stats = await cortexClient.getProductivityAnalytics(userIdRef.current);
        const totalFocus = stats.reduce((acc, curr) => acc + curr.focus, 0);
        const totalDist = stats.reduce((acc, curr) => acc + curr.distraction, 0);
        const reply = `Today you spent ${Math.round(totalFocus / 60)} minutes in deep focus, and had ${Math.round(totalDist / 60)} minutes of distraction logs.`;
        
        setTimeout(() => {
          setCompanionState("answering");
          setMsgs((prev) => [...prev, { role: "ai", text: reply }]);
          setTimeout(() => {
            setCompanionState("idle");
          }, 1000);
        }, 500);
      } catch (err) {
        setMsgs((prev) => [...prev, { role: "ai", text: "I couldn't fetch your statistics logs for today." }]);
        setCompanionState("idle");
      }
      return;
    }

    // Add temporary placeholder for streaming assistant response
    setMsgs((prev) => [...prev, { role: "ai", text: "..." }]);

    let streamText = "";
    try {
      await cortexClient.chatStream(
        userIdRef.current,
        textToSend,
        "general",
        "all",
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
          
          setCompanionState("answering");
          setMsgs((prev) => {
            const next = [...prev];
            if (next.length > 0 && next[next.length - 1].role === "ai") {
              next[next.length - 1] = { role: "ai", text: streamText };
            }
            return next;
          });
        }
      );

      setTimeout(() => {
        setCompanionState("idle");
      }, 1500);

    } catch (err) {
      console.error(err);
      setMsgs((prev) => {
        const next = [...prev];
        if (next.length > 0 && next[next.length - 1].role === "ai") {
          next[next.length - 1] = { role: "ai", text: "Sorry, I had trouble reaching the AI Engine." };
        }
        return next;
      });
      setCompanionState("idle");
    }
  };

  const handleLensTrigger = async () => {
    const api = (window as any).cortexAPI;
    if (!api || !api.startLens) {
      alert("Lens screen capture is only supported inside the Desktop App container.");
      return;
    }

    try {
      setLensLoading(true);
      if (api.resizeCompanionWidget) {
        api.resizeCompanionWidget(false);
      }
      
      const croppedBase64 = await api.startLens();
      
      if (api.resizeCompanionWidget) {
        api.resizeCompanionWidget(true);
      }

      if (croppedBase64) {
        setLensPreview(croppedBase64);
      }
    } catch (err) {
      console.error("Lens trigger failed:", err);
    } finally {
      setLensLoading(false);
    }
  };

  const handleLensAction = async (action: "explain" | "translate" | "summarize" | "ocr" | "ask", customPrompt?: string) => {
    if (!lensPreview || !userIdRef.current) return;

    const base64Image = lensPreview;
    setLensPreview(null);
    setCompanionState("thinking");

    let userMessage = "";
    if (action === "explain") userMessage = "Lens Selection: Explain selected code / content region.";
    else if (action === "translate") userMessage = "Lens Selection: Translate selected screen text to English.";
    else if (action === "summarize") userMessage = "Lens Selection: Summarize selected screen context.";
    else if (action === "ocr") userMessage = "Lens Selection: Extract text from selection.";
    else userMessage = `Lens Selection: "${customPrompt || "Analyze selection"}".`;

    setMsgs(prev => [...prev, { role: "user", text: userMessage }]);
    setMsgs(prev => [...prev, { role: "ai", text: "Analyzing selection context..." }]);

    try {
      const res = await cortexClient.analyzeLens({
        user_id: userIdRef.current,
        image_base64: base64Image,
        action,
        custom_prompt: customPrompt
      });

      setCompanionState("answering");
      setMsgs(prev => {
        const next = [...prev];
        if (next.length > 0 && next[next.length - 1].role === "ai") {
          next[next.length - 1] = {
            role: "ai",
            text: res.result || "No text detected."
          };
        }
        return next;
      });

      setTimeout(() => {
        setCompanionState("idle");
      }, 1500);
    } catch (err: any) {
      console.error("Lens action failed:", err);
      setMsgs(prev => {
        const next = [...prev];
        if (next.length > 0 && next[next.length - 1].role === "ai") {
          next[next.length - 1] = {
            role: "ai",
            text: `Lens processing failed: ${err.message || String(err)}. Ensure your local Ollama or vision API provider is running.`
          };
        }
        return next;
      });
      setCompanionState("idle");
    }
  };

  // Rendering Helper: Avatar styles
  const getAvatarBorderClass = () => {
    switch (companionState) {
      case "listening":
        return "border-blue-400 animate-pulse shadow-[0_0_12px_rgba(96,165,250,0.5)]";
      case "thinking":
        return "border-purple-400 animate-spin border-t-transparent shadow-[0_0_12px_rgba(192,132,252,0.5)]";
      case "answering":
        return "border-emerald-400 animate-pulse shadow-[0_0_12px_rgba(52,211,153,0.5)]";
      case "focus":
        return "border-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.3)] animate-pulse";
      case "warning":
        return "border-rose-500 shadow-[0_0_16px_rgba(244,63,94,0.6)] animate-bounce";
      case "sleeping":
        return "border-slate-600 opacity-60 shadow-none";
      case "idle":
      default:
        return "border-foreground/30 hover:border-foreground/60 shadow-[0_0_6px_rgba(255,255,255,0.05)]";
    }
  };

  return (
    <div className="flex h-screen w-screen select-none items-end justify-end p-2 bg-transparent overflow-hidden font-sans text-foreground">
      {expanded ? (
        <div className="flex flex-col h-[520px] w-[360px] rounded-2xl border border-border/80 bg-[#141416]/95 backdrop-blur-xl shadow-2xl overflow-hidden animate-in fade-in duration-300">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/60 bg-surface-2/20 px-4 py-3 cursor-move" style={{ WebkitAppRegion: "drag" } as any}>
            <div className="flex items-center gap-2" style={{ WebkitAppRegion: "no-drag" } as any}>
              <div className="relative h-6 w-6 rounded-md border border-border bg-surface-3 grid place-items-center">
                <Sparkles className="h-3 w-3 text-emerald-400" />
              </div>
              <div>
                <span className="text-xs font-semibold">Cortex Chat</span>
                <span className="ml-1.5 text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1 py-0.2 rounded uppercase">Live</span>
              </div>
            </div>
            <div className="flex items-center gap-1" style={{ WebkitAppRegion: "no-drag" } as any}>
              <button onClick={handleMinimize} className="rounded p-1 text-muted-foreground hover:bg-surface-3 hover:text-foreground cursor-pointer transition">
                <Minimize2 className="h-3.5 w-3.5" />
              </button>
              <button onClick={handleClose} className="rounded p-1 text-muted-foreground hover:bg-surface-3 hover:text-destructive cursor-pointer transition">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Chat Messages Panel */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5 scrollbar-thin select-text">
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed border ${
                  m.role === "user"
                    ? "bg-foreground text-background border-transparent"
                    : "bg-surface-2/60 text-foreground border-border/40"
                }`}>
                  {m.text}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Active Context indicator */}
          {activeSession && (
            <div className="px-4 py-1.5 border-t border-border/40 bg-surface-2/10 flex items-center justify-between text-[10px] text-muted-foreground select-none">
              <span className="flex items-center gap-1 truncate">
                <span className={`h-1.5 w-1.5 rounded-full ${activeState === "DISTRACTION" ? "bg-rose-400" : "bg-emerald-400"}`} />
                Target: {activeSession.intention}
              </span>
              <span className="shrink-0 font-mono">App: {activeApp}</span>
            </div>
          )}

          {/* Composer Input Bar / Lens Preview */}
          {lensPreview ? (
            <div className="border-t border-border/60 bg-surface-2/15 p-3 space-y-2.5 animate-in fade-in duration-200">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="font-semibold">Lens Captured Region</span>
                <button onClick={() => setLensPreview(null)} className="hover:text-foreground cursor-pointer">
                  Cancel
                </button>
              </div>
              <div className="overflow-hidden rounded border border-border bg-surface-1 max-h-[100px] flex items-center justify-center">
                <img src={lensPreview} alt="Lens selection preview" className="max-h-[90px] object-contain" />
              </div>
              <div className="flex gap-1.5 justify-between">
                <button
                  onClick={() => handleLensAction("explain")}
                  className="flex-1 rounded bg-surface-2 hover:bg-surface-3 py-1 text-[10px] font-semibold border border-border/80 transition cursor-pointer text-center text-muted-foreground hover:text-foreground"
                >
                  Explain
                </button>
                <button
                  onClick={() => handleLensAction("translate")}
                  className="flex-1 rounded bg-surface-2 hover:bg-surface-3 py-1 text-[10px] font-semibold border border-border/80 transition cursor-pointer text-center text-muted-foreground hover:text-foreground"
                >
                  Translate
                </button>
                <button
                  onClick={() => handleLensAction("ocr")}
                  className="flex-1 rounded bg-surface-2 hover:bg-surface-3 py-1 text-[10px] font-semibold border border-border/80 transition cursor-pointer text-center text-muted-foreground hover:text-foreground"
                >
                  OCR
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  placeholder="Ask a custom question..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.currentTarget.value.trim()) {
                      handleLensAction("ask", e.currentTarget.value);
                    }
                  }}
                  className="flex-1 rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-foreground/30"
                />
              </div>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="border-t border-border/60 bg-surface-2/15 p-3 flex gap-2 items-center"
            >
              <button
                type="button"
                onClick={handleLensTrigger}
                disabled={lensLoading}
                className="rounded-lg bg-surface-2 border border-border p-2 text-muted-foreground hover:text-foreground hover:bg-surface-3 transition cursor-pointer disabled:opacity-50"
                title="Capture screen selection with Lens"
              >
                <Camera className="h-3.5 w-3.5" />
              </button>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={lensLoading ? "Starting Lens..." : "Ask Cortex about your focus..."}
                className="flex-1 rounded-lg border border-border bg-surface-1 px-3 py-2 text-xs outline-none focus:border-foreground/30 text-foreground"
                disabled={lensLoading}
              />
              <button type="submit" className="rounded-lg bg-foreground text-background hover:bg-foreground/90 p-2 transition cursor-pointer" disabled={!input.trim() || lensLoading}>
                <Send className="h-3.5 w-3.5" />
              </button>
            </form>
          )}
        </div>
      ) : (
        /* Collapsed Circle Avatar state */
        <div className="relative group flex flex-col items-center gap-1.5 animate-in zoom-in-75 duration-200">
          {companionState === "sleeping" && (
            <div className="absolute -top-3.5 left-2 text-[10px] text-slate-500 font-mono tracking-widest animate-bounce">
              Zzz...
            </div>
          )}
          {companionState === "warning" && (
            <div className="absolute -top-6 rounded-md bg-rose-500/90 backdrop-blur border border-rose-400 text-[10px] px-2 py-0.5 text-white flex items-center gap-1 shadow-lg animate-bounce select-none">
              <AlertCircle className="h-3 w-3" /> Focus!
            </div>
          )}

          {/* The Pet Button Container */}
          <div
            onClick={toggleExpand}
            onContextMenu={(e) => {
              e.preventDefault();
              if ((window as any).cortexAPI?.showCompanionContextMenu) {
                (window as any).cortexAPI.showCompanionContextMenu();
              }
            }}
            className={`h-[72px] w-[72px] rounded-full border-2 bg-black/80 grid place-items-center cursor-pointer transition-all duration-300 ${getAvatarBorderClass()}`}
            title="Right-click for options · Click to chat"
          >
            {/* Visual core state design */}
            <div className={`h-8 w-8 rounded-full transition-all duration-500 ${
              companionState === "listening" ? "bg-blue-400 scale-110" :
              companionState === "thinking" ? "bg-purple-400 scale-95" :
              companionState === "answering" ? "bg-emerald-400 scale-105" :
              companionState === "focus" ? "bg-emerald-500/80 scale-100 animate-pulse" :
              companionState === "warning" ? "bg-rose-500 scale-105 animate-ping" :
              companionState === "sleeping" ? "bg-slate-700 scale-90" :
              "bg-foreground/15 scale-100"
            }`}>
              {/* Pet facial/visual dynamic elements */}
              <div className="h-full w-full flex items-center justify-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${companionState === "sleeping" ? "bg-slate-500 h-0.5" : "bg-foreground"}`} />
                <span className={`h-1.5 w-1.5 rounded-full ${companionState === "sleeping" ? "bg-slate-500 h-0.5" : "bg-foreground"}`} />
              </div>
            </div>
          </div>
          
          {/* Quick Close controls on widget hover */}
          <button
            onClick={handleClose}
            className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-black border border-border text-muted-foreground hover:text-foreground rounded-full p-0.5 cursor-pointer shadow-md"
            title="Exit companion mode"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
