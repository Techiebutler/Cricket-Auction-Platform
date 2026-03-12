"use client";

import { useState, useEffect, useRef } from "react";
import api from "@/lib/api";

interface User {
  id: number;
  name: string;
  email: string;
  roles: string[];
  profile_photo: string | null;
}

interface Props {
  eventId: number;
  role: "organizer" | "auctioneer";
  label: string;
  currentUserId?: number | null;
  onAssigned: (user: User | null, status: "assigned" | "invited") => void;
  /** Override the POST endpoint for the invite/assign action */
  inviteEndpoint?: string;
}

function isValidEmail(val: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
}

export default function UserSearchInvite({ eventId, role, label, currentUserId, onAssigned, inviteEndpoint }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Load current assigned user on mount
  useEffect(() => {
    if (!currentUserId) return;
    api.get(`/admin/users`).then(({ data }) => {
      const u = data.find((u: User) => u.id === currentUserId);
      if (u) { setSelected(u); setQuery(u.name); }
    }).catch(() => {});
  }, [currentUserId]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleChange = (val: string) => {
    setQuery(val);
    setSelected(null);
    setFeedback(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.length < 1) { setResults([]); setOpen(false); return; }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.get(`/admin/users/search?q=${encodeURIComponent(val)}`);
        setResults(data);
        setOpen(true);
      } catch {}
      finally { setLoading(false); }
    }, 300);
  };

  const pickUser = (user: User) => {
    setSelected(user);
    setQuery(user.name);
    setResults([]);
    setOpen(false);
  };

  const doAssignOrInvite = async (emailOverride?: string) => {
    const email = emailOverride || selected?.email || (isValidEmail(query) ? query : null);
    if (!email) return;
    setInviting(true);
    setFeedback(null);
    try {
      const endpoint = inviteEndpoint ?? `/admin/events/${eventId}/invite`;
      const body = inviteEndpoint ? { email } : { email, role };
      const { data } = await api.post(endpoint, body);
      if (data.status === "assigned" && data.user) {
        setSelected(data.user);
        setQuery(data.user.name);
        onAssigned(data.user, "assigned");
        setFeedback({ type: "ok", msg: data.message });
      } else {
        onAssigned(null, "invited");
        setFeedback({ type: "ok", msg: data.message });
        setQuery("");
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setFeedback({ type: "err", msg: msg || "Failed" });
    } finally {
      setInviting(false);
    }
  };

  const canInviteEmail = !selected && isValidEmail(query) && results.length === 0 && !loading;

  return (
    <div ref={wrapRef}>
      <label className="label">{label}</label>

      {/* Selected chip */}
      {selected ? (
        <div className="flex items-center gap-3 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-sm overflow-hidden shrink-0">
            {selected.profile_photo
              ? <img src={selected.profile_photo} alt="" className="w-full h-full object-cover" />
              : "👤"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{selected.name}</p>
            <p className="text-xs text-gray-500 truncate">{selected.email}</p>
          </div>
          <div className="flex items-center gap-2">
            {!selected.roles.includes(role) && (
              <button
                className="btn-primary text-xs py-1 px-3"
                disabled={inviting}
                onClick={() => doAssignOrInvite(selected.email)}
              >
                {inviting ? "..." : "Assign"}
              </button>
            )}
            {selected.roles.includes(role) && (
              <span className="text-xs text-green-400 font-medium">✓ Assigned</span>
            )}
            <button
              className="text-gray-500 hover:text-white text-lg leading-none"
              onClick={() => { setSelected(null); setQuery(""); setFeedback(null); }}
            >
              ×
            </button>
          </div>
        </div>
      ) : (
        <div className="relative">
          <input
            className="input pr-8"
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            placeholder={`Search name / type email to invite`}
          />
          {loading && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs">
              ...
            </span>
          )}

          {/* Dropdown results */}
          {open && results.length > 0 && (
            <div className="absolute z-20 w-full mt-1 bg-gray-800 border border-gray-700 rounded-xl shadow-xl overflow-hidden">
              {results.map((u) => (
                <button
                  key={u.id}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-700 transition-colors text-left"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickUser(u)}
                >
                  <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-sm overflow-hidden shrink-0">
                    {u.profile_photo
                      ? <img src={u.profile_photo} alt="" className="w-full h-full object-cover" />
                      : "👤"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{u.name}</p>
                    <p className="text-xs text-gray-500 truncate">{u.email}</p>
                  </div>
                  {u.roles.includes(role) && (
                    <span className="text-xs text-green-400 shrink-0">Has role</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Invite unregistered email */}
          {canInviteEmail && (
            <div className="mt-2">
              <button
                className="w-full flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 hover:border-amber-500 rounded-lg px-3 py-2.5 text-sm text-amber-400 transition-colors"
                disabled={inviting}
                onClick={() => doAssignOrInvite(query)}
              >
                <span className="text-base">✉️</span>
                <span>
                  {inviting ? "Sending invite..." : `Send invite to ${query}`}
                </span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Feedback */}
      {feedback && (
        <p className={`text-xs mt-2 ${feedback.type === "ok" ? "text-green-400" : "text-red-400"}`}>
          {feedback.msg}
        </p>
      )}
    </div>
  );
}
