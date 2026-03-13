"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import api from "@/lib/api";
import { useAuthStore } from "@/store/auth";

interface InviteInfo {
  email: string;
  event_name: string;
  role: string;
  event_id: number;
}

function AcceptInviteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const setAuth = useAuthStore((s) => s.setAuth);

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    if (!token) {
      setError("Missing invite token.");
      setFetching(false);
      return;
    }
    api.get(`/auth/invite-info?token=${token}`)
      .then(({ data }) => setInvite(data))
      .catch(() => setError("This invite link is invalid or has expired."))
      .finally(() => setFetching(false));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { data } = await api.post("/auth/accept-invite", {
        name: form.name,
        password: form.password,
        token,
      });
      setAuth(data.user, data.access_token);
      // Redirect based on role
      const role = invite?.role;
      if (role === "organizer") router.push("/organizer/events");
      else if (role === "auctioneer") router.push("/dashboard");
      else router.push("/dashboard");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Failed to accept invite");
    } finally {
      setLoading(false);
    }
  };

  if (fetching) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Verifying invite...</p>
      </div>
    );
  }

  if (error && !invite) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="card text-center max-w-md w-full">
          <p className="text-4xl mb-4">🔗</p>
          <h2 className="text-xl font-bold mb-2">Invalid Invite Link</h2>
          <p className="text-gray-500 text-sm mb-4">{error}</p>
          <a href="/auth/login" className="btn-secondary text-sm">
            Go to Login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-md">
        {/* Invite badge */}
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-6 text-center">
          <p className="text-amber-400 font-semibold text-sm">
            You've been invited to{" "}
            <span className="text-white">{invite?.event_name}</span>
          </p>
          <p className="text-gray-500 text-xs mt-1">
            Role:{" "}
            <span className="capitalize text-amber-400">{invite?.role}</span>
            {" "}· {invite?.email}
          </p>
        </div>

        <h1 className="text-xl font-bold mb-1">Create your account</h1>
        <p className="text-gray-500 text-sm mb-5">
          Your email is pre-set from the invite. Just enter your name and a password.
        </p>

        {error && (
          <div className="bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg p-3 mb-4 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Email</label>
            <input className="input opacity-60 cursor-not-allowed" value={invite?.email || ""} disabled />
          </div>
          <div>
            <label className="label">Full Name</label>
            <input
              type="text"
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Your Name"
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
              placeholder="Choose a password"
              required
              minLength={6}
            />
          </div>
          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? "Setting up..." : "Accept Invite & Join"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><p className="text-gray-500">Loading...</p></div>}>
      <AcceptInviteContent />
    </Suspense>
  );
}
