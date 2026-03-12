"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import api from "@/lib/api";
import UserSearchInvite from "@/components/UserSearchInvite";

interface AuctionEvent {
  id: number;
  name: string;
  status: string;
  organizer_id: number | null;
  allowed_domains: string[];
  scheduled_at: string | null;
}

function toLocalDatetimeValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STATUS_COLOR: Record<string, string> = {
  draft: "bg-gray-700 text-gray-300",
  ready: "bg-blue-500/20 text-blue-400",
  active: "bg-green-500/20 text-green-400",
  paused: "bg-amber-500/20 text-amber-400",
  completed: "bg-gray-800 text-gray-500",
};

export default function AdminEventDetailPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const eid = parseInt(eventId);
  const [event, setEvent] = useState<AuctionEvent | null>(null);
  const [domains, setDomains] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    api.get(`/admin/events/${eid}`).then(({ data }) => {
      setEvent(data);
      setDomains(data.allowed_domains.join(", "));
      setScheduledAt(toLocalDatetimeValue(data.scheduled_at));
    });
  }, [eid]);

  const flash = (type: "ok" | "err", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3000);
  };

  const saveDomains = async () => {
    setSaving(true);
    try {
      const { data } = await api.patch(`/admin/events/${eid}`, {
        allowed_domains: domains.split(",").map((d) => d.trim()).filter(Boolean),
      });
      setEvent(data);
      flash("ok", "Domains saved.");
    } catch {
      flash("err", "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const saveSchedule = async () => {
    setScheduleSaving(true);
    try {
      const { data } = await api.patch(`/admin/events/${eid}`, {
        scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      });
      setEvent(data);
      flash("ok", "Schedule saved.");
    } catch {
      flash("err", "Failed to save schedule.");
    } finally {
      setScheduleSaving(false);
    }
  };

  return (
    <div className="min-h-screen p-8 bg-gray-950">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <a href="/admin/events" className="text-gray-500 hover:text-white text-sm">← Events</a>
          <h1 className="text-2xl font-bold">{event?.name || "..."}</h1>
          {event && (
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize ${STATUS_COLOR[event.status] ?? ""}`}>
              {event.status}
            </span>
          )}
        </div>

        {/* Flash message */}
        {msg && (
          <div className={`rounded-lg p-3 mb-4 text-sm ${msg.type === "ok" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
            {msg.text}
          </div>
        )}

        <div className="space-y-5">
          {/* Organizer */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
              Organizer
            </h2>
            <UserSearchInvite
              eventId={eid}
              role="organizer"
              label="Assign or invite organizer"
              currentUserId={event?.organizer_id}
              onAssigned={(user) => {
                if (user) setEvent((e) => e ? { ...e, organizer_id: user.id } : e);
              }}
            />
          </div>

          {/* Schedule */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-1">
              Auction Schedule
            </h2>
            <p className="text-xs text-gray-600 mb-4">
              Set the date and time when the live auction will take place.
              This is shown on event cards so participants know when to join.
            </p>
            <input
              type="datetime-local"
              className="input mb-3"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
            {scheduledAt && (
              <p className="text-xs text-amber-400/80 mb-3">
                📅 {new Date(scheduledAt).toLocaleString("en-IN", {
                  weekday: "long", day: "numeric", month: "long",
                  year: "numeric", hour: "2-digit", minute: "2-digit",
                })}
              </p>
            )}
            <button className="btn-primary" onClick={saveSchedule} disabled={scheduleSaving}>
              {scheduleSaving ? "Saving..." : "Save Schedule"}
            </button>
          </div>

          {/* Allowed domains */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-1">
              Allowed Email Domains
            </h2>
            <p className="text-xs text-gray-500 mb-4">
              Only users with these email domains will appear in the player pool.
              Leave blank to allow all users.
            </p>
            <input
              className="input mb-3"
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              placeholder="techiebutler.com, saasflash.ai"
            />
            <button className="btn-primary" onClick={saveDomains} disabled={saving}>
              {saving ? "Saving..." : "Save Domains"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
