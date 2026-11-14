import React, { useState, useEffect, useRef, useCallback } from "react";
import { Mic, MicOff, Loader2, Volume2, VolumeX, Keyboard, Send, Trash2, X, Settings2, ShieldCheck, Sparkles } from "lucide-react";
import { getSiaResponse, getSiaAudio, resetSiaSession as resetSiyaSession } from "./services/geminiService";
import { processCommand } from "./services/commandService";
import { LiveSessionManager } from "./services/liveService";
import Visualizer from "./components/Visualizer";
import PermissionModal from "./components/PermissionModal";
import { playPCM } from "./utils/audioUtils";
import { motion, AnimatePresence } from "motion/react";
import { PersonalityMode } from "./services/personalityService";
import AuthGate, { AuthUser } from "./components/AuthGate";
import DeveloperDashboard from "./components/DeveloperDashboard";
import AdminLogsModal from "./components/AdminLogsModal";
import DeveloperWelcomeOverlay from "./components/DeveloperWelcomeOverlay";

type AppState = "idle" | "listening" | "processing" | "speaking";

interface ChatMessage {
  id: string;
  sender: "user" | "siya";
  text: string;
}

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

function SiyaApp({
  user,
  isDeveloper,
  onLogout,
  onDeveloper,
  onShowWelcome,
}: {
  user: AuthUser;
  isDeveloper: boolean;
  onLogout: () => void;
  onDeveloper: () => void;
  onShowWelcome?: () => void;
}) {
  const [appState, setAppState] = useState<AppState>("idle");
  const [expression, setExpression] = useState<string>("smile");
  const [showAdminModal, setShowAdminModal] = useState<boolean>(false);
  const [liveToast, setLiveToast] = useState<{
    id: number;
    name: string;
    email: string;
    event: "signup" | "login";
  } | null>(null);
  const lastLogIdRef = useRef<number>(0);
  const hasInitializedLogsRef = useRef<boolean>(false);

  useEffect(() => {
    const pollLogs = async () => {
      try {
        const savedToken = localStorage.getItem("siya_token") || "";
        const headers: HeadersInit = savedToken ? { "x-siya-session": savedToken } : {};
        const res = await fetch("/api/developer/logs?limit=3", { credentials: "include", headers });
        if (!res.ok) return;
        const data = await res.json();
        const logs = data.logs || [];
        if (logs.length > 0) {
          const newest = logs[0];
          if (!hasInitializedLogsRef.current) {
            lastLogIdRef.current = newest.id;
            hasInitializedLogsRef.current = true;
          } else if (newest.id > lastLogIdRef.current) {
            lastLogIdRef.current = newest.id;
            setLiveToast(newest);
            setTimeout(() => {
              setLiveToast((prev) => (prev?.id === newest.id ? null : prev));
            }, 7000);
          }
        }
      } catch {
        // ignore
      }
    };
    pollLogs();
    const timer = setInterval(pollLogs, 3500);
    return () => clearInterval(timer);
  }, [isDeveloper]);

  const userStorageKey = `siya_chat_history_${user.id || user.email}`;
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const key = `siya_chat_history_${user.id || user.email}`;
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const filtered = parsed.filter(m => !m.text.includes('[Error:') && !m.text.includes('[System:'));
          if (filtered.length > 0) return filtered;
        }
      } catch (e) {
        console.error("Failed to parse chat history", e);
      }
    }
    return [
      {
        id: "welcome-init",
        sender: "siya",
        text: `Haan ${user.name}, bolo kya kaam hai? Main sun rahi hoon!`,
      },
    ];
  });
  const messagesRef = useRef(messages);
  const [personalityMode, setPersonalityMode] = useState<PersonalityMode>(() => {
    return (localStorage.getItem("siya_personality_mode") as PersonalityMode) || "Sassy";
  });
  const [showSettings, setShowSettings] = useState(false);

  // Sync ref
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Load user conversation history from backend if available
  useEffect(() => {
    const savedToken = localStorage.getItem("siya_token") || "";
    const headers: HeadersInit = savedToken ? { "x-siya-session": savedToken } : {};
    fetch("/api/chat/messages", { credentials: "include", headers })
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          if (data.messages && data.messages.length > 0) {
            setMessages(data.messages);
            localStorage.setItem(userStorageKey, JSON.stringify(data.messages));
          }
        }
      })
      .catch(() => {});
  }, [user.id, user.email, userStorageKey]);

  // Helper to persist message to both user-specific state/localStorage and backend
  const appendMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => {
      const next = [...prev, msg];
      localStorage.setItem(userStorageKey, JSON.stringify(next));
      return next;
    });

    if (!msg.text.startsWith("[Error:") && !msg.text.startsWith("[System:")) {
      const savedToken = localStorage.getItem("siya_token") || "";
      const headers: HeadersInit = {
        "Content-Type": "application/json",
        ...(savedToken ? { "x-siya-session": savedToken } : {}),
      };
      fetch("/api/chat/messages", {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({ sender: msg.sender, text: msg.text }),
      }).catch(() => {});
    }
  }, [userStorageKey]);

  useEffect(() => {
    localStorage.setItem("siya_personality_mode", personalityMode);
    resetSiyaSession();
  }, [personalityMode]);

  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    if (liveSessionRef.current) {
      liveSessionRef.current.isMuted = isMuted;
    }
  }, [isMuted]);

  const [showTextInput, setShowTextInput] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [isSessionActive, setIsSessionActive] = useState(false);

  const liveSessionRef = useRef<LiveSessionManager | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, appState]);

  const extractExpression = (text: string) => {
    const matches = text.match(/\[(.*?)\]/g);
    if (matches && matches.length > 0) {
      const lastTag = matches[matches.length - 1];
      return lastTag.replace('[', '').replace(']', '').trim();
    }
    return null;
  };

  const handleTextCommand = useCallback(async (finalTranscript: string) => {
    if (!finalTranscript.trim()) {
      setAppState("idle");
      return;
    }

    appendMessage({ id: Date.now().toString(), sender: "user", text: finalTranscript });
    
    // If live session is active, send text through it
    if (isSessionActive && liveSessionRef.current) {
      liveSessionRef.current.sendText(finalTranscript);
      return;
    }

    setAppState("processing");

    // Check if user is asking to view user activity or logins
    const lower = finalTranscript.toLowerCase();
    if (
      lower.includes("login") ||
      lower.includes("signup") ||
      lower.includes("kaun kaun") ||
      lower.includes("activity") ||
      lower.includes("admin") ||
      (lower.includes("user") && (lower.includes("dikhao") || lower.includes("list") || lower.includes("show") || lower.includes("batao")))
    ) {
      setShowAdminModal(true);
      const resp = `Maine aapke samne Siya ke andar hi Live Activity aur User Logs panel open kar diya hai ${user.name}! Yahan aap sabhi users ke logins aur signups dekh sakte hain.`;
      appendMessage({ id: Date.now().toString() + "-s", sender: "siya", text: resp });
      if (!isMuted) {
        setAppState("speaking");
        const audioBase64 = await getSiaAudio(resp);
        if (audioBase64) await playPCM(audioBase64);
      }
      setAppState("idle");
      return;
    }

    // 1. Check for browser commands
    const commandResult = processCommand(finalTranscript);

    let responseText = "";

    if (commandResult.isBrowserAction) {
      responseText = commandResult.action;
      appendMessage({ id: Date.now().toString() + "-s", sender: "siya", text: responseText });
      
      if (!isMuted) {
        setAppState("speaking");
        const audioBase64 = await getSiaAudio(responseText);
        if (audioBase64) {
          await playPCM(audioBase64);
        }
      }

      setAppState("idle");

      setTimeout(() => {
        if (commandResult.url) {
          window.open(commandResult.url, "_blank");
        }
      }, 1500);
    } else {
      // 2. General Chit-Chat via Gemini with User Identity & Name recognition
      try {
        responseText = await getSiaResponse(finalTranscript, messagesRef.current, personalityMode, user.name, user.email);
      } catch (err: any) {
        console.error("Gemini response error", err);
        responseText = `Haan ${user.name}, main sun rahi hoon! Kuch connectivity issue tha, ek baar phir se bolo na?`;
      }
      
      const newExpr = extractExpression(responseText);
      if (newExpr) setExpression(newExpr);

      appendMessage({ id: Date.now().toString() + "-s", sender: "siya", text: responseText });
      
      if (!isMuted) {
        setAppState("speaking");
        try {
          const audioBase64 = await getSiaAudio(responseText);
          if (audioBase64) {
            await playPCM(audioBase64);
          }
        } catch (e) {
          console.error("Audio playback error", e);
        }
      }
      setAppState("idle");
    }
  }, [isMuted, isSessionActive, personalityMode, user.name, user.email, appendMessage]);

  const speechRecognitionRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (liveSessionRef.current) {
        liveSessionRef.current.stop();
      }
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.stop(); } catch (e) {}
      }
    };
  }, []);

  const startSpeechFallback = useCallback(() => {
    const SpeechRecClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecClass) {
      appendMessage({
        id: Date.now().toString() + "-fallback",
        sender: "siya",
        text: `Haan ${user.name}, voice listener activate nahi ho paya. Aap neeche keyboard icon daba kar mujhse chat kar sakte hain!`
      });
      setIsSessionActive(false);
      setAppState("idle");
      return;
    }

    try {
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.stop(); } catch (e) {}
      }

      const recognition = new SpeechRecClass();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = "hi-IN";

      recognition.onstart = () => {
        setAppState("listening");
        setIsSessionActive(true);
      };

      recognition.onresult = (event: any) => {
        const transcript = event.results?.[0]?.[0]?.transcript || "";
        if (transcript.trim()) {
          handleTextCommand(transcript);
        }
      };

      recognition.onerror = (event: any) => {
        console.warn("Speech recognition error:", event.error);
        setIsSessionActive(false);
        setAppState("idle");
      };

      recognition.onend = () => {
        setIsSessionActive(false);
        setAppState((prev) => (prev === "listening" ? "idle" : prev));
      };

      speechRecognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.warn("Speech recognition failed to start:", err);
      setIsSessionActive(false);
      setAppState("idle");
    }
  }, [user.name, handleTextCommand, appendMessage]);

  const toggleListening = async () => {
    if (isSessionActive) {
      setIsSessionActive(false);
      if (liveSessionRef.current) {
        liveSessionRef.current.stop();
        liveSessionRef.current = null;
      }
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.stop(); } catch (e) {}
        speechRecognitionRef.current = null;
      }
      setAppState("idle");
      resetSiyaSession();
    } else {
      try {
        setIsSessionActive(true);
        resetSiyaSession();
        
        const session = new LiveSessionManager(personalityMode, user.name, user.email);
        session.isMuted = isMuted;
        liveSessionRef.current = session;
        
        session.onStateChange = (state) => {
          setAppState(state);
          if (state === "idle") {
            setIsSessionActive(false);
          }
        };

        session.onError = (message) => {
          const lowerMsg = (message || "").toLowerCase();
          if (!lowerMsg.includes("websocket") && !lowerMsg.includes("closed without opened") && !lowerMsg.includes("connection lost")) {
            appendMessage({ id: Date.now().toString() + "-error", sender: "siya", text: `[Error: ${message}]` });
          }
        };

        session.onMessage = (sender, text) => {
          appendMessage({ id: Date.now().toString() + "-" + sender, sender, text });
          if (sender === "siya") {
            const expr = extractExpression(text);
            if (expr) setExpression(expr);
          }
        };
        
        session.onCommand = (url) => {
          setTimeout(() => {
            window.open(url, "_blank");
          }, 1000);
        };

        await session.start();
      } catch (e: any) {
        if (e?.message === "Permission denied" || e?.name === "NotAllowedError") {
          console.warn("Microphone permission denied by user.");
          setShowPermissionModal(true);
          setIsSessionActive(false);
          setAppState("idle");
        } else {
          console.warn("Live API direct connection unavailable, switching to browser speech recognition fallback:", e);
          if (liveSessionRef.current) {
            liveSessionRef.current.stop();
            liveSessionRef.current = null;
          }
          startSpeechFallback();
        }
      }
    }
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim()) return;
    
    handleTextCommand(textInput);
    setTextInput("");
    setShowTextInput(false);
  };

  return (
    <div className="h-[100dvh] w-screen bg-[#050505] text-white flex flex-col items-center justify-between font-sans relative overflow-hidden m-0 p-0">
      {showPermissionModal && (
        <PermissionModal 
          onClose={() => setShowPermissionModal(false)} 
        />
      )}

      {/* Cinematic Background Gradients */}
      <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-violet-900/20 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-pink-900/20 blur-[120px] rounded-full" />
      </div>

      {/* Header */}
      <header className="absolute top-0 left-0 w-full flex justify-between items-start z-20 shrink-0 px-6 py-4 md:px-12 md:py-6">
        {/* Real-time auth event toast for developers */}
        <AnimatePresence>
          {isDeveloper && liveToast && (
            <motion.div
              id="dev-live-toast-alert"
              initial={{ opacity: 0, y: -25, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.96 }}
              onClick={() => setShowAdminModal(true)}
              className="fixed top-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl bg-[#0e0e14]/95 border border-emerald-500/40 text-white shadow-2xl backdrop-blur-2xl cursor-pointer hover:border-emerald-400 transition-all"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <div className="text-left text-xs">
                <div className="font-semibold text-emerald-300">
                  {liveToast.event === "signup" ? "New User Registered!" : "User Just Signed In!"}
                </div>
                <div className="text-white/70 truncate max-w-xs">
                  <span className="font-medium text-white">{liveToast.name}</span> ({liveToast.email})
                </div>
              </div>
              <span className="text-[11px] bg-white/10 hover:bg-white/20 px-2.5 py-1 rounded-xl text-white/80 font-medium ml-1 shrink-0">
                View in Siya →
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-3 mt-1">
          <div className="flex flex-col">
            <h1 className="text-2xl font-serif font-bold tracking-widest opacity-90 leading-tight uppercase bg-clip-text text-transparent bg-gradient-to-r from-violet-400 to-pink-400">SIYA</h1>
            <button
              onClick={onShowWelcome}
              className="text-[10px] text-white/50 hover:text-violet-300 tracking-wider uppercase font-medium text-left transition-colors flex items-center gap-1.5 cursor-pointer group"
              title="Click to view Developer Welcome Card (Shivam Yadav)"
            >
              <span className="group-hover:underline decoration-violet-400/50">Developed by Shivam Yadav</span>
              <span className="text-white/20">·</span>
              <span className="text-violet-300/80 font-semibold">{user.name}</span>
            </button>
          </div>
        </div>
        
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            {/* Always accessible In-App Logs & Users Button */}
            <button
              id="header-activity-logs-btn"
              onClick={() => setShowAdminModal(true)}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-xs font-semibold text-emerald-300 hover:text-emerald-100 transition-all shadow-[0_0_15px_rgba(16,185,129,0.2)] cursor-pointer"
              title="View User Logins & Signups inside Siya (ID/Password)"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <ShieldCheck size={14} />
              <span>Users & Logins</span>
            </button>

            <button
              id="header-settings-btn"
              onClick={() => setShowSettings(!showSettings)}
              className={`p-2 rounded-full transition-colors border border-white/10 cursor-pointer ${showSettings ? 'bg-white/20 text-white' : 'bg-white/5 hover:bg-white/10'}`}
              title="Settings"
            >
              <Settings2 size={18} className="opacity-70" />
            </button>

            {messages.length > 0 && (
              <button
                onClick={() => {
                  if (confirm("Are you sure you want to clear your chat history?")) {
                    setMessages([
                      {
                        id: "welcome-init",
                        sender: "siya",
                        text: `Haan ${user.name}, bolo kya kaam hai? Main sun rahi hoon!`,
                      },
                    ]);
                    localStorage.removeItem(userStorageKey);
                    const savedToken = localStorage.getItem("siya_token") || "";
                    fetch("/api/chat/messages", {
                      method: "DELETE",
                      credentials: "include",
                      headers: savedToken ? { "x-siya-session": savedToken } : {},
                    }).catch(() => {});
                    resetSiyaSession();
                  }
                }}
                className="p-2 rounded-full bg-white/5 hover:bg-red-500/20 hover:text-red-400 transition-colors border border-white/10 cursor-pointer"
                title="Clear Chat History"
              >
                <Trash2 size={18} className="opacity-70" />
              </button>
            )}
            <button
              onClick={() => setIsMuted(!isMuted)}
              className="p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors border border-white/10"
              title={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted ? (
                <VolumeX size={18} className="opacity-70" />
              ) : (
                <Volume2 size={18} className="opacity-70" />
              )}
            </button>
            <button onClick={onLogout} className="px-3 py-2 rounded-full bg-white/5 hover:bg-red-500/10 border border-white/10 text-[10px] uppercase tracking-wider text-white/50 hover:text-white transition-colors">Logout</button>
          </div>

          <AnimatePresence>
            {showSettings && (
              <motion.div 
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                className="mt-2 bg-[#121212] border border-white/10 p-2 rounded-2xl shadow-2xl flex flex-col gap-1 w-52 backdrop-blur-xl"
              >
                <div className="px-3 py-1.5 text-xs text-white/40 uppercase tracking-wider font-semibold">Mode</div>
                {(["Sassy"] as PersonalityMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => {
                      setPersonalityMode(mode);
                      setShowSettings(false);
                      // If active, tell the user they need to restart the session
                      if (isSessionActive) {
                        alert("Mode changed. Please end and restart the session to apply.");
                      }
                    }}
                    className={`text-left px-3 py-2 rounded-xl text-sm transition-colors ${
                      personalityMode === mode 
                        ? "bg-violet-600/30 text-violet-300 font-medium border border-violet-500/30" 
                        : "text-white/70 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {mode}
                  </button>
                ))}

                <div className="border-t border-white/10 my-1 pt-1 flex flex-col gap-1">
                  <button
                    id="settings-developer-card-btn"
                    onClick={() => {
                      setShowSettings(false);
                      onShowWelcome?.();
                    }}
                    className="w-full text-left px-3 py-2 rounded-xl text-xs text-violet-300 hover:bg-violet-500/10 hover:text-violet-200 flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <Sparkles size={14} className="text-violet-400" />
                    <span>Developer Card (Shivam)</span>
                  </button>
                  <button
                    id="settings-activity-logs-btn"
                    onClick={() => {
                      setShowSettings(false);
                      setShowAdminModal(true);
                    }}
                    className="w-full text-left px-3 py-2 rounded-xl text-xs text-white/80 hover:bg-white/10 hover:text-white flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <ShieldCheck size={14} className="text-emerald-400" />
                    <span>View Logins & Users</span>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </header>

      {/* Main Content - Visualizer & Chat */}
      <main className="absolute inset-0 flex flex-row items-center justify-between w-full h-full z-10 overflow-hidden pt-20 pb-24 px-4 md:px-12 pointer-events-none">
        
        {/* Left Column: Siya Status */}
        <div className="flex w-[30%] lg:w-[25%] h-full flex-col justify-center gap-4 z-10">
          <div className="h-6">
            <AnimatePresence>
              {appState === "processing" && (
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="flex items-center gap-2 text-cyan-300/80 text-sm md:text-base italic font-serif"
                >
                  <Loader2 size={16} className="animate-spin" />
                  Replying...
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Center Visualizer (Fixed Full Screen Background) */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
          <Visualizer state={appState} expression={expression} />
        </div>

        {/* Right Column: User Status */}
        <div className="flex w-[30%] lg:w-[25%] h-full flex-col justify-center gap-4 z-10 pointer-events-auto">
          <div className="h-6 flex justify-end">
            <AnimatePresence>
              {appState === "listening" && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="flex items-center gap-2 text-violet-300/80 text-sm md:text-base italic"
                >
                  <div className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
                  Listening...
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* Controls */}
      <footer className="absolute bottom-0 left-0 w-full flex flex-col items-center justify-center pb-6 md:pb-8 z-20 shrink-0 gap-4">
        <AnimatePresence>
          {showTextInput && (
            <motion.form 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              onSubmit={handleTextSubmit}
              className="w-full max-w-md flex items-center gap-2 bg-white/5 border border-white/10 rounded-full p-1 pl-4 backdrop-blur-md shadow-2xl"
            >
              <input 
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Type a message to Siya..."
                className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/30 text-sm"
                autoFocus
              />
              <button 
                type="submit"
                disabled={!textInput.trim()}
                className="p-2 rounded-full bg-violet-500 hover:bg-violet-600 disabled:opacity-50 disabled:hover:bg-violet-500 transition-colors"
              >
                <Send size={16} />
              </button>
            </motion.form>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-4">
          <button
            onClick={toggleListening}
            className={`
              group relative flex items-center gap-3 px-8 py-4 rounded-full font-medium tracking-wide transition-all duration-300 shadow-2xl
              ${
                isSessionActive
                  ? "bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30"
                  : "bg-white/10 text-white border border-white/20 hover:bg-white/20 hover:scale-105"
              }
            `}
          >
            {isSessionActive ? (
              <>
                <MicOff size={20} />
                <span>End Session</span>
              </>
            ) : (
              <>
                <Mic size={20} className="group-hover:animate-bounce" />
                <span>Start Session</span>
              </>
            )}
          </button>
          
          {!isSessionActive && (
            <button
              onClick={() => setShowTextInput(!showTextInput)}
              className="p-4 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors shadow-2xl"
              title="Type instead"
            >
              <Keyboard size={20} className="opacity-70" />
            </button>
          )}
        </div>
      </footer>

      {/* In-App Admin & User Activity Logs Modal */}
      <AdminLogsModal
        isOpen={showAdminModal}
        onClose={() => setShowAdminModal(false)}
        isDeveloperSession={isDeveloper}
        currentEmail={user.email}
        onOpenFullscreenConsole={onDeveloper}
      />
    </div>
  );
}


export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isDeveloper, setIsDeveloper] = useState(false);
  const [developerOpen, setDeveloperOpen] = useState(false);
  const [checking, setChecking] = useState(true);
  const [showWelcomeSplash, setShowWelcomeSplash] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me").then(async r => {
      if (r.ok) { const data = await r.json(); setUser(data.user); setIsDeveloper(Boolean(data.developer)); }
    }).finally(() => setChecking(false));
  }, []);

  const handleAuth = useCallback((nextUser: AuthUser, developer: boolean) => {
    setUser(nextUser);
    setIsDeveloper(developer);
    setDeveloperOpen(false);
    setShowWelcomeSplash(true); // Automatically shows after login or signup
  }, []);
  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setIsDeveloper(false);
    setDeveloperOpen(false);
    setShowWelcomeSplash(false);
  }, []);

  if (checking) return <div className="min-h-[100dvh] bg-[#030305] grid place-items-center text-white/50">Loading secure session…</div>;
  if (!user) return <AuthGate onAuthenticated={handleAuth} />;

  return (
    <>
      <AnimatePresence>
        {showWelcomeSplash && (
          <DeveloperWelcomeOverlay
            user={user}
            onDismiss={() => setShowWelcomeSplash(false)}
          />
        )}
      </AnimatePresence>

      {developerOpen && isDeveloper ? (
        <DeveloperDashboard user={user} onExit={() => setDeveloperOpen(false)} onLogout={logout} />
      ) : (
        <SiyaApp
          user={user}
          isDeveloper={isDeveloper}
          onLogout={logout}
          onDeveloper={() => setDeveloperOpen(true)}
          onShowWelcome={() => setShowWelcomeSplash(true)}
        />
      )}
    </>
  );
}
