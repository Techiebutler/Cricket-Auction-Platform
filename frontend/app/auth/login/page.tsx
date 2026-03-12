"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import api from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import RolePicker from "@/components/RolePicker";

type Mode = "password" | "magic";

function afterLogin(
  data: { user: { roles: string[]; onboarded: boolean } },
  setAuth: (u: unknown, t: string) => void,
  setShowRolePicker: (v: boolean) => void,
  router: ReturnType<typeof useRouter>,
  token: string,
) {
  setAuth(data.user, token);
  if (!data.user.onboarded) {
    router.push("/onboarding");
    return;
  }
  if ((data.user.roles ?? ["player"]).length > 1) {
    setShowRolePicker(true);
  } else {
    router.push("/dashboard");
  }
}

// ─── Password visibility toggle ──────────────────────────────────────────────
function PasswordInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        className="input pr-11"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="••••••••"
        required
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors text-sm select-none"
        tabIndex={-1}
      >
        {show ? "🙈" : "👁"}
      </button>
    </div>
  );
}

// ─── Magic code digit inputs ──────────────────────────────────────────────────
function CodeInput({ onComplete }: { onComplete: (code: string) => void }) {
  const [digits, setDigits] = useState(Array(6).fill(""));
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = (idx: number, val: string) => {
    const clean = val.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[idx] = clean;
    setDigits(next);
    if (clean && idx < 5) refs.current[idx + 1]?.focus();
    if (next.every((d) => d)) onComplete(next.join(""));
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !digits[idx] && idx > 0) {
      refs.current[idx - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 6) {
      const next = pasted.split("");
      setDigits(next);
      refs.current[5]?.focus();
      onComplete(pasted);
    }
  };

  return (
    <div className="flex gap-2 justify-center" onPaste={handlePaste}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={d}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          className="w-11 h-14 text-center text-2xl font-bold bg-gray-800 border border-gray-700 rounded-xl focus:outline-none focus:border-amber-500 text-white transition-colors"
          autoFocus={i === 0}
        />
      ))}
    </div>
  );
}

// ─── Main login page ──────────────────────────────────────────────────────────
export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showRolePicker, setShowRolePicker] = useState(false);

  // Magic code state
  const [codeSent, setCodeSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [codeLoading, setCodeLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // Countdown timer for resend
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  if (showRolePicker) return <RolePicker />;

  // ── Password login ──
  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { data } = await api.post("/auth/login", { email, password });
      afterLogin(data, setAuth as never, setShowRolePicker, router, data.access_token);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Invalid email or password");
      // ✅ Do NOT clear email/password — user stays in context
    } finally {
      setLoading(false);
    }
  };

  // ── Send magic code ──
  const handleSendCode = async () => {
    if (!email) { setError("Enter your email first"); return; }
    setCodeLoading(true);
    setError("");
    try {
      await api.post("/auth/send-magic-code", { email });
      setCodeSent(true);
      setCountdown(60); // allow resend after 60s
    } catch {
      setError("Failed to send code. Try again.");
    } finally {
      setCodeLoading(false);
    }
  };

  // ── Verify magic code ──
  const handleVerifyCode = async (code: string) => {
    setVerifying(true);
    setError("");
    try {
      const { data } = await api.post("/auth/verify-magic-code", { email, code });
      afterLogin(data, setAuth as never, setShowRolePicker, router, data.access_token);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Invalid or expired code");
      setVerifying(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-6">
          <span className="text-4xl">🏏</span>
          <h1 className="text-2xl font-bold mt-2">Sign In</h1>
          <p className="text-gray-500 text-sm mt-1">Cricket Auction Platform</p>
        </div>

        {/* Mode switcher */}
        <div className="flex gap-1 bg-gray-800 rounded-xl p-1 mb-5">
          {(["password", "magic"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setError(""); setCodeSent(false); }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                mode === m ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {m === "password" ? "🔑 Password" : "✉️ Email Code"}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg p-3 mb-4 text-sm">
            {error}
          </div>
        )}

        {/* ── Password mode ── */}
        {mode === "password" && (
          <form onSubmit={handlePasswordLogin} className="space-y-4">
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
              />
            </div>
            <div>
              <label className="label">Password</label>
              <PasswordInput value={password} onChange={setPassword} />
            </div>
            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        )}

        {/* ── Magic code mode ── */}
        {mode === "magic" && (
          <div className="space-y-4">
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                className="input"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setCodeSent(false); setCountdown(0); }}
                placeholder="you@company.com"
                disabled={codeSent}
                required
              />
            </div>

            {!codeSent ? (
              <button
                type="button"
                className="btn-primary w-full"
                onClick={handleSendCode}
                disabled={codeLoading || !email}
              >
                {codeLoading ? "Sending..." : "Send Login Code"}
              </button>
            ) : (
              <div className="space-y-4">
                {/* Success hint */}
                <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-3 text-center">
                  <p className="text-green-400 text-sm font-medium">Code sent!</p>
                  <p className="text-gray-500 text-xs mt-0.5">
                    Check <strong className="text-gray-300">{email}</strong> for a 6-digit code
                  </p>
                </div>

                {/* 6-digit input */}
                <CodeInput onComplete={handleVerifyCode} />

                {verifying && (
                  <p className="text-center text-gray-500 text-sm animate-pulse">Verifying...</p>
                )}

                {/* Resend */}
                <div className="text-center">
                  {countdown > 0 ? (
                    <p className="text-xs text-gray-600">Resend in {countdown}s</p>
                  ) : (
                    <button
                      type="button"
                      className="text-xs text-amber-400 hover:underline"
                      onClick={handleSendCode}
                      disabled={codeLoading}
                    >
                      {codeLoading ? "Sending..." : "Resend code"}
                    </button>
                  )}
                </div>

                {/* Change email */}
                <button
                  type="button"
                  className="w-full text-xs text-gray-500 hover:text-white transition-colors"
                  onClick={() => { setCodeSent(false); setCountdown(0); setError(""); }}
                >
                  ← Use a different email
                </button>
              </div>
            )}
          </div>
        )}

        <p className="text-center text-gray-500 text-sm mt-5">
          Don&apos;t have an account?{" "}
          <Link href="/auth/signup" className="text-amber-400 hover:underline">
            Register
          </Link>
        </p>
      </div>
    </div>
  );
}
