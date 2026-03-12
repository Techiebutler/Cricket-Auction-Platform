"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";

interface Event {
  id: number;
  name: string;
  status: string;
  organizer_id: number | null;
  allowed_domains: string[];
  scheduled_at: string | null;
  created_at: string;
}

function formatScheduled(iso: string | null | undefined) {
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Returns a datetime-local string in local time for the input value
function toLocalDatetimeValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-700 text-gray-400",
  ready: "bg-blue-500/20 text-blue-400",
  active: "bg-green-500/20 text-green-400",
  paused: "bg-amber-500/20 text-amber-400",
  completed: "bg-gray-800 text-gray-500",
};

export default function AdminEventsPage() {
  const router = useRouter();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", domains: "", scheduled_at: "" });
  const [error, setError] = useState("");

  useEffect(() => { fetchEvents(); }, []);

  const fetchEvents = async () => {
    try {
      const { data } = await api.get("/admin/events");
      setEvents(data);
    } catch {
      router.push("/auth/login");
    } finally {
      setLoading(false);
    }
  };

  const createEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError("");
    try {
      const domains = form.domains.split(",").map((d) => d.trim()).filter(Boolean);
      const { data } = await api.post("/admin/events", {
        name: form.name,
        description: form.description || null,
        allowed_domains: domains,
        scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
      });
      setEvents([data, ...events]);
      setForm({ name: "", description: "", domains: "", scheduled_at: "" });
      setShowForm(false);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Failed to create event");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen p-8 bg-gray-950">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <a href="/dashboard" className="text-gray-500 hover:text-white text-sm">← Dashboard</a>
            <h1 className="text-2xl font-bold">Auction Events</h1>
          </div>
          <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancel" : "+ New Event"}
          </button>
        </div>

        {/* Create form */}
        {showForm && (
          <div className="card mb-6 border-amber-500/30">
            <h2 className="text-lg font-semibold mb-5">Create New Event</h2>
            {error && (
              <div className="bg-red-500/20 text-red-400 rounded-lg p-3 mb-4 text-sm">{error}</div>
            )}
            <form onSubmit={createEvent} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="label">Event Name *</label>
                  <input
                    className="input"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="TBPL 2026"
                    required
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="label">Description</label>
                  <input
                    className="input"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Annual company cricket player auction"
                  />
                </div>

                {/* Date & Time */}
                <div>
                  <label className="label">Auction Date & Time</label>
                  <input
                    type="datetime-local"
                    className="input"
                    value={form.scheduled_at}
                    onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })}
                  />
                  <p className="text-xs text-gray-600 mt-1">When the live auction will happen</p>
                </div>

                <div>
                  <label className="label">Allowed Email Domains</label>
                  <input
                    className="input"
                    value={form.domains}
                    onChange={(e) => setForm({ ...form, domains: e.target.value })}
                    placeholder="techiebutler.com, example.com"
                  />
                  <p className="text-xs text-gray-600 mt-1">Comma-separated. Leave blank for all.</p>
                </div>
              </div>

              <div className="flex gap-3 pt-1">
                <button type="submit" className="btn-primary" disabled={creating}>
                  {creating ? "Creating..." : "Create Event"}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Events list */}
        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="card h-20 animate-pulse" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="card text-center text-gray-500 py-16">
            <p className="text-3xl mb-3">🎪</p>
            <p className="font-medium mb-1">No events yet</p>
            <p className="text-sm">Click &ldquo;+ New Event&rdquo; to get started.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {events.map((event) => {
              const scheduled = formatScheduled(event.scheduled_at);
              return (
                <div
                  key={event.id}
                  className="card flex items-center justify-between gap-4 hover:border-gray-700 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold truncate">{event.name}</p>
                      <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full capitalize font-medium ${STATUS_BADGE[event.status] ?? ""}`}>
                        {event.status}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
                      {scheduled && (
                        <span className="flex items-center gap-1 text-amber-400/80">
                          📅 {scheduled}
                        </span>
                      )}
                      <span>
                        Domains: {event.allowed_domains.length > 0 ? event.allowed_domains.join(", ") : "Any"}
                      </span>
                    </div>
                  </div>
                  <button
                    className="btn-secondary text-sm shrink-0"
                    onClick={() => router.push(`/admin/events/${event.id}`)}
                  >
                    Manage →
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
