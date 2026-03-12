"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import api from "@/lib/api";
import UserSearchInvite from "@/components/UserSearchInvite";

interface User {
  id: number;
  name: string;
  email: string;
  roles: string[];
  batting_rating: number;
  bowling_rating: number;
  fielding_rating: number;
  profile_photo: string | null;
}

interface AuctionPlayer {
  id: number;
  player_id: number;
  base_price: number;
  status: string;
}

interface Team {
  id: number;
  name: string;
  color: string;
  captain_id: number | null;
  budget: number;
  max_players: number;
  players: unknown[];
}

interface EventDetail {
  id: number;
  name: string;
  status: string;
  auctioneer_id: number | null;
  scheduled_at: string | null;
}

interface Readiness {
  checks: Record<string, boolean>;
  ready: boolean;
  teams_count: number;
  teams_with_captain: number;
  players_count: number;
  auctioneer_id: number | null;
}

const CHECK_LABELS: Record<string, string> = {
  organizer_assigned: "Organizer assigned",
  auctioneer_assigned: "Auctioneer assigned",
  teams_created: "At least 2 teams created",
  all_teams_have_captain: "All teams have a captain",
  players_added: "At least 1 player added",
};

// ─── Teams Tab ────────────────────────────────────────────────────────────────

// IPL-inspired preset palette
const COLOR_PRESETS = [
  { hex: "#1E40AF", label: "Royal Blue" },
  { hex: "#7C3AED", label: "Purple" },
  { hex: "#DC2626", label: "Red" },
  { hex: "#059669", label: "Green" },
  { hex: "#D97706", label: "Gold" },
  { hex: "#DB2777", label: "Pink" },
  { hex: "#0891B2", label: "Teal" },
  { hex: "#EA580C", label: "Orange" },
  { hex: "#4F46E5", label: "Indigo" },
  { hex: "#65A30D", label: "Lime" },
  { hex: "#9D174D", label: "Maroon" },
  { hex: "#0F766E", label: "Dark Teal" },
];

function hexToRgb(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function isDark(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

function TeamColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  return (
    <div>
      <label className="label">Team Color</label>
      {/* Preset swatches */}
      <div className="flex flex-wrap gap-2 mb-3">
        {COLOR_PRESETS.map((c) => (
          <button
            key={c.hex}
            type="button"
            title={c.label}
            onClick={() => onChange(c.hex)}
            className="w-8 h-8 rounded-lg transition-all hover:scale-110 border-2"
            style={{
              backgroundColor: c.hex,
              borderColor: value === c.hex ? "white" : "transparent",
              boxShadow: value === c.hex ? `0 0 0 2px ${c.hex}` : "none",
            }}
          />
        ))}
        {/* Custom color swatch */}
        <label
          title="Custom color"
          className="w-8 h-8 rounded-lg border-2 border-dashed border-gray-600 hover:border-gray-400 cursor-pointer flex items-center justify-center text-gray-400 text-xs transition-colors relative overflow-hidden"
        >
          <span>+</span>
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
          />
        </label>
      </div>
      {/* Preview */}
      <div
        className="flex items-center gap-3 rounded-xl px-4 py-2.5"
        style={{ backgroundColor: value }}
      >
        <span
          className="text-sm font-bold"
          style={{ color: isDark(value) ? "white" : "#111" }}
        >
          Team Name Preview
        </span>
        <span
          className="text-xs ml-auto font-mono"
          style={{ color: isDark(value) ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.5)" }}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

function TeamsTab({
  eventId,
  teams,
  eligiblePlayers,
  teamForm,
  setTeamForm,
  onCreateTeam,
  onAssignCaptain,
  editable,
}: {
  eventId: number;
  teams: Team[];
  eligiblePlayers: User[];
  teamForm: { name: string; color: string; budget: string; max_players: string };
  setTeamForm: (f: { name: string; color: string; budget: string; max_players: string }) => void;
  onCreateTeam: (e: React.FormEvent) => void;
  onAssignCaptain: (teamId: number, captainId: string) => void;
}) {
  const [showForm, setShowForm] = useState(editable && teams.length === 0);
  const playerMap = Object.fromEntries(eligiblePlayers.map((p) => [p.id, p]));

  const handleSubmit = async (e: React.FormEvent) => {
    await onCreateTeam(e);
    setShowForm(false);
  };

  return (
    <div className="space-y-4">
      {/* Common budget / max players for all teams */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Budget (credits) — applies to all teams</label>
          <input
            className={`input ${!editable ? "bg-gray-900 text-gray-500 cursor-not-allowed" : ""}`}
            type="number"
            min={100}
            value={teamForm.budget}
            onChange={(e) => editable && setTeamForm({ ...teamForm, budget: e.target.value })}
            disabled={!editable}
          />
        </div>
        <div>
          <label className="label">Max Players per team</label>
          <input
            className={`input ${!editable ? "bg-gray-900 text-gray-500 cursor-not-allowed" : ""}`}
            type="number"
            min={1}
            max={25}
            value={teamForm.max_players}
            onChange={(e) => editable && setTeamForm({ ...teamForm, max_players: e.target.value })}
            disabled={!editable}
          />
        </div>
      </div>

      {/* Existing teams */}
      {teams.length > 0 && (
        <div className="space-y-3">
          {teams.map((team) => {
            const captain = team.captain_id ? playerMap[team.captain_id] : null;
            const textColor = isDark(team.color) ? "white" : "#111827";
            const subtextColor = isDark(team.color) ? "rgba(255,255,255,0.65)" : "rgba(0,0,0,0.5)";

            return (
              <div key={team.id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                {/* Colored header */}
                <div
                  className="px-5 py-4 flex items-center justify-between"
                  style={{ backgroundColor: team.color }}
                >
                  <div>
                    <h3 className="font-bold text-lg" style={{ color: textColor }}>{team.name}</h3>
                    <p className="text-xs mt-0.5" style={{ color: subtextColor }}>
                      Budget: {team.budget.toLocaleString()} · Max {team.max_players} players
                    </p>
                  </div>
                  {team.captain_id ? (
                    <span className="text-xs px-2.5 py-1 rounded-full font-medium"
                      style={{ backgroundColor: "rgba(255,255,255,0.2)", color: textColor }}>
                      ✓ Captain set
                    </span>
                  ) : (
                    <span className="text-xs px-2.5 py-1 rounded-full"
                      style={{ backgroundColor: "rgba(0,0,0,0.25)", color: isDark(team.color) ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.5)" }}>
                      No captain yet
                    </span>
                  )}
                </div>

                {/* Captain section */}
                <div className="px-5 py-4">
                  <label className="label">Assign Captain</label>
                  {captain && (
                    <div className="flex items-center gap-3 mb-3 bg-gray-800 rounded-xl px-3 py-2.5">
                      <div className="w-9 h-9 rounded-full overflow-hidden bg-gray-700 shrink-0 flex items-center justify-center">
                        {captain.profile_photo
                          ? <img src={captain.profile_photo} alt="" className="w-full h-full object-cover" />
                          : <span>👤</span>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{captain.name}</p>
                        <p className="text-xs text-gray-500">{captain.email}</p>
                      </div>
                      <span className="text-xs font-medium" style={{ color: team.color }}>Captain</span>
                    </div>
                  )}

                  {editable ? (
                    <select
                      className="input text-sm"
                      value={team.captain_id?.toString() || ""}
                      onChange={(e) => onAssignCaptain(team.id, e.target.value)}
                    >
                      <option value="">{captain ? "Change captain..." : "— Select captain —"}</option>
                      {eligiblePlayers.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} · {p.email}</option>
                      ))}
                    </select>
                  ) : (
                    !captain && (
                      <p className="text-xs text-gray-600 mt-1">
                        Unpublish the event to assign a captain.
                      </p>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add team button / form */}
      {editable && (
        !showForm ? (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="w-full border-2 border-dashed border-gray-700 hover:border-amber-500/50 hover:bg-amber-500/5 rounded-2xl py-6 text-gray-500 hover:text-amber-400 transition-all flex items-center justify-center gap-2 text-sm font-medium"
          >
            <span className="text-xl leading-none">＋</span>
            Add {teams.length > 0 ? "Another" : "First"} Team
          </button>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="bg-gray-900 border-2 border-amber-500/30 rounded-2xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white">New Team</h3>
              {teams.length > 0 && (
                <button type="button" onClick={() => setShowForm(false)}
                  className="text-gray-500 hover:text-white text-xl leading-none">×</button>
              )}
            </div>

            <div>
              <label className="label">Team Name *</label>
              <input
                className="input"
                value={teamForm.name}
                onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })}
                placeholder="e.g. Mumbai Indians"
                required
                autoFocus
              />
            </div>

            <TeamColorPicker
              value={teamForm.color}
              onChange={(hex) => setTeamForm({ ...teamForm, color: hex })}
            />

            <div className="flex gap-3 pt-1">
              <button type="submit" className="btn-primary flex-1">Create Team</button>
              {teams.length > 0 && (
                <button type="button" className="btn-secondary px-5" onClick={() => setShowForm(false)}>Cancel</button>
              )}
            </div>
          </form>
        )
      )}
    </div>
  );
}

// ─── Players Tab ──────────────────────────────────────────────────────────────

function isValidEmail(val: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
}

function PlayersTab({
  eventId,
  eligiblePlayers,
  auctionPlayers,
  onAdd,
  onRemove,
  onInvited,
  onToast,
  editable,
}: {
  eventId: number;
  eligiblePlayers: User[];
  auctionPlayers: AuctionPlayer[];
  onAdd: (id: number) => void;
  onRemove: (id: number) => void;
  onInvited: () => void;
  onToast: (type: "ok" | "err", text: string) => void;
  editable: boolean;
}) {
  const [search, setSearch] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const addedIds = new Set(auctionPlayers.map((ap) => ap.player_id));

  const filtered = eligiblePlayers.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.email.toLowerCase().includes(search.toLowerCase())
  );

  // Is the typed search text an email not already in the list?
  const notFound =
    search.length > 3 &&
    isValidEmail(search) &&
    !eligiblePlayers.some((p) => p.email.toLowerCase() === search.toLowerCase());

  const sendInvite = async (email: string) => {
    setInviting(true);
    try {
      const { data } = await api.post(`/organizer/events/${eventId}/invite-player`, { email });
      onToast("ok", data.message);
      setSearch("");
      if (data.status === "added") onInvited();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      onToast("err", msg || "Failed to invite");
    } finally {
      setInviting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Search + invite bar */}
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">🔍</div>
        <input
          className="input pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email — or type a full email to invite"
        />
      </div>

      {/* Invite unregistered email prompt */}
      {editable && notFound && (
        <div className="flex items-center justify-between bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3">
          <div>
            <p className="text-sm text-amber-300 font-medium">Not registered yet</p>
            <p className="text-xs text-gray-500 mt-0.5">{search}</p>
          </div>
          <button
            className="btn-primary text-sm py-1.5 px-4 shrink-0"
            disabled={inviting}
            onClick={() => sendInvite(search)}
          >
            {inviting ? "Sending..." : "Send Invite"}
          </button>
        </div>
      )}

      {/* Player grid */}
      {eligiblePlayers.length === 0 ? (
        <div className="card text-center py-10 text-gray-500 text-sm">
          No eligible players found. Make sure allowed email domains are configured in the admin panel.
        </div>
      ) : filtered.length === 0 && !notFound ? (
        <div className="text-center py-8 text-gray-600 text-sm">
          No players match &ldquo;{search}&rdquo;
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((player) => {
            const added = addedIds.has(player.id);
            return (
              <div
                key={player.id}
                className={`flex items-center gap-3 bg-gray-900 border rounded-xl p-3 transition-colors ${
                  added ? "border-green-800/50" : "border-gray-800"
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-gray-800 overflow-hidden shrink-0 flex items-center justify-center">
                  {player.profile_photo ? (
                    <img src={player.profile_photo} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-lg">👤</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{player.name}</p>
                  <p className="text-xs text-gray-500 truncate">{player.email}</p>
                  <div className="flex gap-2 text-xs text-gray-600 mt-0.5">
                    <span>🏏 {player.batting_rating}</span>
                    <span>🎯 {player.bowling_rating}</span>
                    <span>🤸 {player.fielding_rating}</span>
                  </div>
                </div>
                {added ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="badge-sold">Added ✓</span>
                    {editable && (
                      <button
                        className="text-gray-600 hover:text-red-400 transition-colors text-lg leading-none"
                        onClick={() => onRemove(player.id)}
                        title="Remove from event"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ) : editable ? (
                  <button
                    className="btn-primary text-xs px-3 py-1.5 shrink-0"
                    onClick={() => onAdd(player.id)}
                  >
                    Add
                  </button>
                ) : (
                  <span className="text-xs text-gray-600">Locked</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Summary footer */}
      <p className="text-xs text-gray-600 text-right">
        {auctionPlayers.length} of {eligiblePlayers.length} eligible players added
      </p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OrganizerEventDetailPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const router = useRouter();
  const eid = parseInt(eventId);

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [eligiblePlayers, setEligiblePlayers] = useState<User[]>([]);
  const [auctionPlayers, setAuctionPlayers] = useState<AuctionPlayer[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [tab, setTab] = useState<"players" | "teams" | "auctioneer">("players");
  const [teamForm, setTeamForm] = useState({ name: "", color: "#3B82F6", budget: "1000", max_players: "11" });
  const [toast, setToast] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [markingReady, setMarkingReady] = useState(false);
  const [scheduleInput, setScheduleInput] = useState("");
  const [savingSchedule, setSavingSchedule] = useState(false);

  const showToast = (type: "ok" | "err", text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchAll = useCallback(async () => {
    const [evRes, eligible, aPlayers, teamsRes, readinessRes] = await Promise.all([
      api.get(`/organizer/events/${eid}`).catch(() => null),
      api.get(`/organizer/events/${eid}/eligible-players`),
      api.get(`/organizer/events/${eid}/players`),
      api.get(`/organizer/events/${eid}/teams`),
      api.get(`/events/${eid}/readiness`),
    ]);
    if (evRes) {
      setEvent(evRes.data);
      if (evRes.data.scheduled_at) {
        const d = new Date(evRes.data.scheduled_at);
        const pad = (n: number) => String(n).padStart(2, "0");
        setScheduleInput(
          `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
        );
      } else {
        setScheduleInput("");
      }
    }
    setEligiblePlayers(eligible.data);
    setAuctionPlayers(aPlayers.data);
    setTeams(teamsRes.data);
    setReadiness(readinessRes.data);
  }, [eid]);

  useEffect(() => {
    fetchAll().catch(() => router.push("/auth/login"));
  }, [eid, fetchAll]);

  // Also fetch event info from the organizer events list
  useEffect(() => {
    api.get(`/organizer/events`).then(({ data }) => {
      const found = data.find((e: EventDetail) => e.id === eid);
      if (found) setEvent(found);
    }).catch(() => {});
  }, [eid]);

  const addPlayer = async (playerId: number) => {
    try {
      await api.post(`/organizer/events/${eid}/players`, { player_id: playerId, base_price: 100 });
      await fetchAll();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      showToast("err", msg || "Failed to add player");
    }
  };

  const removePlayer = async (playerId: number) => {
    try {
      await api.delete(`/organizer/events/${eid}/players/${playerId}`);
      await fetchAll();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      showToast("err", msg || "Failed to remove player");
    }
  };

  const createTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post(`/organizer/events/${eid}/teams`, {
        name: teamForm.name,
        color: teamForm.color,
        budget: parseInt(teamForm.budget),
        max_players: parseInt(teamForm.max_players),
      });
      setTeamForm({ name: "", color: "#3B82F6", budget: "1000", max_players: "11" });
      await fetchAll();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      showToast("err", msg || "Failed");
    }
  };

  const assignCaptain = async (teamId: number, captainId: string) => {
    try {
      await api.patch(`/organizer/events/${eid}/teams/${teamId}`, {
        captain_id: captainId ? parseInt(captainId) : null,
      });
      await fetchAll();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      showToast("err", msg || "Failed");
    }
  };

  const markReady = async () => {
    setMarkingReady(true);
    try {
      await api.patch(`/organizer/events/${eid}/ready`);
      await fetchAll();
      showToast("ok", "Event is now ready for auction!");
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: { errors?: string[] } | string } } })
        ?.response?.data?.detail;
      if (detail && typeof detail === "object" && detail.errors) {
        showToast("err", detail.errors.join(" · "));
      } else {
        showToast("err", typeof detail === "string" ? detail : "Not ready yet");
      }
    } finally {
      setMarkingReady(false);
    }
  };

  const saveSchedule = async () => {
    setSavingSchedule(true);
    try {
      const payload = {
        scheduled_at: scheduleInput ? new Date(scheduleInput).toISOString() : null,
      };
      const { data } = await api.patch(`/organizer/events/${eid}/schedule`, payload);
      setEvent(data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      showToast("err", msg || "Failed to update date");
    } finally {
      setSavingSchedule(false);
    }
  };

  const unpublish = async () => {
    try {
      const { data } = await api.patch(`/organizer/events/${eid}/unpublish`, {});
      setEvent(data);
      showToast("ok", "Event moved back to draft.");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      showToast("err", msg || "Failed to unpublish");
    }
  };

  const addedPlayerIds = new Set(auctionPlayers.map((ap) => ap.player_id));
  const playerMap = Object.fromEntries(eligiblePlayers.map((p) => [p.id, p]));

  const scheduledDate = event?.scheduled_at ? new Date(event.scheduled_at) : null;
  const now = new Date();
  const isLive =
    !!event &&
    (event.status === "active" ||
      event.status === "paused" ||
      event.status === "completed" ||
      (event.status === "ready" && scheduledDate !== null && scheduledDate <= now));
  const isDraft = event?.status === "draft";

  const TABS = [
    { key: "players", label: "Players", count: auctionPlayers.length },
    { key: "teams", label: "Teams", count: teams.length },
    { key: "auctioneer", label: "Auctioneer", count: readiness?.auctioneer_id ? 1 : 0 },
  ] as const;

  return (
    <div className="min-h-screen p-6 bg-gray-950">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <a href="/organizer/events" className="text-gray-500 hover:text-white text-sm">← Events</a>
            <h1 className="text-2xl font-bold">{event?.name || "Event Setup"}</h1>
            {event && (
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize ${
                event.status === "ready" ? "bg-blue-500/20 text-blue-400" :
                event.status === "active" ? "bg-green-500/20 text-green-400" :
                "bg-gray-700 text-gray-400"
              }`}>{event.status}</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wide text-gray-500">Auction date</p>
              <p className="text-xs text-gray-300">
                {event?.scheduled_at
                  ? new Date(event.scheduled_at).toLocaleString("en-IN", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "Not scheduled"}
              </p>
            </div>

            {isDraft && (
              <button
                className="btn-primary"
                onClick={markReady}
                disabled={markingReady || !readiness?.ready}
              >
                {markingReady ? "Checking..." : "Mark Ready"}
              </button>
            )}
            {!isDraft && !isLive && (
              <>
                <span className="text-amber-400 text-sm font-medium">✓ Published (waiting for start)</span>
                <button
                  type="button"
                  className="btn-secondary text-xs ml-2"
                  onClick={unpublish}
                >
                  Unpublish
                </button>
              </>
            )}
            {isLive && (
              <span className="text-green-400 text-sm font-medium">✓ Event is live</span>
            )}
          </div>
        </div>

        {/* Organizer schedule editor (only while in draft) */}
        {event && isDraft && (
          <div className="card mb-5">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-1">
              Auction Schedule
            </h2>
            <p className="text-xs text-gray-500 mb-3">
              Set or adjust the auction date and time. This is visible to all participants.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
              <div className="flex-1">
                <input
                  type="datetime-local"
                  className="input"
                  value={scheduleInput}
                  onChange={(e) => setScheduleInput(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="btn-secondary sm:w-auto"
                onClick={saveSchedule}
                disabled={savingSchedule}
              >
                {savingSchedule ? "Saving..." : "Save Date"}
              </button>
            </div>
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div className={`rounded-lg p-3 mb-4 text-sm ${
            toast.type === "ok"
              ? "bg-green-500/20 text-green-400"
              : "bg-red-500/20 text-red-400"
          }`}>
            {toast.text}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

          {/* Readiness sidebar */}
          <div className="lg:col-span-1">
            <div className="card sticky top-6">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Readiness Checklist
              </h3>
              <div className="space-y-2">
                {readiness && Object.entries(readiness.checks).map(([key, done]) => (
                  <div key={key} className="flex items-start gap-2">
                    <span className={`mt-0.5 shrink-0 ${done ? "text-green-400" : "text-gray-600"}`}>
                      {done ? "✓" : "○"}
                    </span>
                    <span className={`text-xs ${done ? "text-gray-300" : "text-gray-500"}`}>
                      {CHECK_LABELS[key] ?? key}
                    </span>
                  </div>
                ))}
              </div>
              {readiness?.ready && (
                <p className="text-green-400 text-xs mt-3 font-medium">
                  All checks passed!
                </p>
              )}
            </div>
          </div>

          {/* Main content */}
          <div className="lg:col-span-3">
            {/* Tabs */}
            <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit mb-5">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    tab === t.key ? "bg-amber-500 text-black" : "text-gray-400 hover:text-white"
                  }`}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                  {t.count > 0 && (
                    <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                      tab === t.key ? "bg-black/20" : "bg-gray-700"
                    }`}>{t.count}</span>
                  )}
                </button>
              ))}
            </div>

            {/* Players tab */}
            {tab === "players" && (
              <PlayersTab
                eventId={eid}
                eligiblePlayers={eligiblePlayers}
                auctionPlayers={auctionPlayers}
                onAdd={addPlayer}
                onRemove={removePlayer}
                onInvited={fetchAll}
                onToast={showToast}
                editable={isDraft}
              />
            )}

            {/* Teams tab */}
            {tab === "teams" && (
              <TeamsTab
                eventId={eid}
                teams={teams}
                eligiblePlayers={eligiblePlayers}
                teamForm={teamForm}
                setTeamForm={setTeamForm}
                onCreateTeam={createTeam}
                onAssignCaptain={assignCaptain}
                 editable={isDraft}
              />
            )}

            {/* Auctioneer tab */}
            {tab === "auctioneer" && (
              <div className="card">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Assign Auctioneer
                </h3>
                <p className="text-xs text-gray-600 mb-4">
                  Search by name or email. If the person isn't registered yet, they'll receive an invite link.
                </p>
                <div className={isDraft ? "" : "pointer-events-none opacity-75"}>
                  <UserSearchInvite
                    eventId={eid}
                    role="auctioneer"
                    label="Auctioneer"
                    currentUserId={readiness?.auctioneer_id}
                    inviteEndpoint={`/organizer/events/${eid}/invite-auctioneer`}
                    onAssigned={async () => { await fetchAll(); showToast("ok", "Auctioneer assigned!"); }}
                  />
                </div>
                {!isDraft && (
                  <p className="text-[11px] text-gray-500 mt-2">
                    Unpublish the event to change the auctioneer.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
