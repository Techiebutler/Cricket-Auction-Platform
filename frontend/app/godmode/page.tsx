"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { useAuthStore } from "@/store/auth";

export default function GodmodePage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [form, setForm] = useState({ name: "", email: "", password: "", secret: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { data } = await api.post("/auth/godmode", form);
      setAuth(data.user, data.access_token);
      router.push("/admin/events");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gray-950">
      <div className="w-full max-w-md">
        {/* Warning banner */}
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-6 text-center">
          <p className="text-amber-400 text-xs uppercase tracking-widest font-semibold mb-1">
            Restricted Access
          </p>
          <p className="text-gray-400 text-sm">
            Admin bootstrap endpoint. Requires the system godmode secret.
          </p>
        </div>

        <div className="card">
          <div className="text-center mb-6">
            <span className="text-4xl">🛡️</span>
            <h1 className="text-2xl font-bold mt-2">Admin Registration</h1>
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
                placeholder="Admin Name"
                required
              />
            </div>
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                className="input"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="admin@company.com"
                required
              />
            </div>
            <div>
              <label className="label">Password</label>
              <input
                type="password"
                className="input"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="••••••••"
                required
                minLength={6}
              />
            </div>
            <div>
              <label className="label">Godmode Secret</label>
              <input
                type="password"
                className="input"
                value={form.secret}
                onChange={(e) => setForm({ ...form, secret: e.target.value })}
                placeholder="System secret key"
                required
              />
            </div>
            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? "Creating admin..." : "Create Admin Account"}
            </button>
          </form>

          <p className="text-center text-gray-600 text-xs mt-4">
            Default secret in dev: <code className="text-amber-500">GODMODE_CHANGEME</code>
          </p>
        </div>
      </div>
    </div>
  );
}
