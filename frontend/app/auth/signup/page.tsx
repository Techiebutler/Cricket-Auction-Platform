"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import api from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import brandLogo from "@/asset/Logo Png (3).png";

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
        minLength={6}
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

export default function SignupPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { data } = await api.post("/auth/register", form);
      setAuth(data.user, data.access_token);
      // New users always complete onboarding first
      router.push("/onboarding");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-md">
        <div className="text-center mb-6">
          <div className="flex justify-center">
            <Image src={brandLogo} alt="Cricket Auction" className="h-12 w-auto" priority />
          </div>
          <h1 className="text-2xl font-bold mt-2">Join the Auction</h1>
          <p className="text-gray-500 text-sm mt-1">Register as a player to get started</p>
        </div>

        {error && (
          <div className="bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg p-3 mb-4 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Full Name</label>
            <input
              type="text"
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="John Doe"
              required
            />
          </div>
          <div>
            <label className="label">Work Email</label>
            <input
              type="email"
              className="input"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="you@company.com"
              required
            />
          </div>
          <div>
            <label className="label">Password</label>
            <PasswordInput value={form.password} onChange={(v) => setForm({ ...form, password: v })} />
          </div>
          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? "Creating account..." : "Create Account"}
          </button>
        </form>

        <p className="text-center text-gray-500 text-sm mt-4">
          Already have an account?{" "}
          <Link href="/auth/login" className="text-amber-400 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
