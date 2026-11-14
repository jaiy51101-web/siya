import { FormEvent, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, LockKeyhole, Sparkles } from "lucide-react";

export type AuthUser = { id: number; name: string; email: string };
type Props = { onAuthenticated: (user: AuthUser, developer: boolean) => void };

export default function AuthGate({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const savedToken = localStorage.getItem("siya_token") || "";
    fetch("/api/auth/me", {
      credentials: "include",
      headers: savedToken ? { "x-siya-session": savedToken } : {},
    }).then(async (r) => {
      if (!r.ok) return;
      const data = await r.json();
      if (data.authenticated) onAuthenticated(data.user, data.developer);
    }).catch(() => {});
  }, [onAuthenticated]);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/signup";
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Something went wrong");
      if (data.token) {
        localStorage.setItem("siya_token", data.token);
      }
      onAuthenticated(data.user, data.developer);
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  };

  return <div className="min-h-[100dvh] w-full bg-[#030305] text-white grid place-items-center p-6 relative overflow-hidden">
    <div className="absolute -top-40 -left-40 w-96 h-96 bg-violet-600/20 blur-[120px] rounded-full" />
    <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-pink-600/15 blur-[120px] rounded-full" />
    <motion.div initial={{ opacity: 0, y: 25, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .6 }} className="relative w-full max-w-md rounded-[32px] border border-white/10 bg-white/[.055] backdrop-blur-2xl p-7 md:p-9 shadow-2xl">
      <div className="flex items-center gap-3 mb-8"><div className="grid place-items-center w-11 h-11 rounded-2xl bg-gradient-to-br from-violet-500 to-pink-500"><Sparkles size={20}/></div><div><div className="font-bold tracking-[.28em]">SIYA</div><div className="text-xs text-white/40">Secure access layer</div></div></div>
      <h2 className="text-3xl font-semibold tracking-tight">{mode === "login" ? "Welcome back." : "Create your account."}</h2>
      <p className="text-sm text-white/45 mt-2 mb-7">Your account protects your Siya workspace and keeps developer controls private.</p>
      <form onSubmit={submit} className="space-y-4">
        <AnimatePresence initial={false}>
          {mode === "signup" && (
            <motion.input
              id="signup-name-input"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 48 }}
              exit={{ opacity: 0, height: 0 }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full h-12 rounded-2xl bg-black/30 border border-white/10 px-4 outline-none focus:border-violet-400/60"
              required
            />
          )}
        </AnimatePresence>
        <input
          id="auth-email-input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="Email address"
          className="w-full h-12 rounded-2xl bg-black/30 border border-white/10 px-4 outline-none focus:border-violet-400/60"
          required
        />
        <input
          id="auth-password-input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          placeholder="Password (minimum 8 characters)"
          minLength={8}
          className="w-full h-12 rounded-2xl bg-black/30 border border-white/10 px-4 outline-none focus:border-violet-400/60"
          required
        />
        {error && (
          <div id="auth-error-banner" className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-2xl px-4 py-3">
            {error}
          </div>
        )}
        <button
          id="auth-submit-btn"
          type="submit"
          disabled={busy}
          className="group w-full h-12 rounded-2xl bg-white text-black font-semibold flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
        >
          {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          <ArrowRight size={17} className="group-hover:translate-x-1 transition-transform" />
        </button>
      </form>
      <button
        id="auth-mode-toggle-btn"
        type="button"
        onClick={() => {
          setMode(mode === "login" ? "signup" : "login");
          setError("");
        }}
        className="w-full mt-5 text-sm text-white/50 hover:text-white transition-colors cursor-pointer"
      >
        {mode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}
      </button>
      <div className="mt-7 pt-5 border-t border-white/10 flex items-center justify-center gap-2 text-[11px] uppercase tracking-[.16em] text-white/30"><LockKeyhole size={13}/> Protected authentication</div>
    </motion.div>
  </div>;
}
