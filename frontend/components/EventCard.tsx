"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface EventCard {
  id: number;
  name: string;
  description?: string | null;
  status: string;
  team_count: number;
  player_count: number;
  allowed_domains: string[];
  scheduled_at?: string | null;
  created_at: string;
  my_roles?: string[];
  viewer_count?: number;
  logo?: string | null;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string; bg: string }> = {
  draft: { label: "Draft", color: "text-gray-400", dot: "bg-gray-500", bg: "from-gray-700 to-gray-800" },
  ready: { label: "Ready", color: "text-blue-400", dot: "bg-blue-500", bg: "from-blue-900/50 to-indigo-900/50" },
  active: { label: "Live", color: "text-green-400", dot: "bg-green-400", bg: "from-green-900/50 to-emerald-900/50" },
  paused: { label: "Paused", color: "text-amber-400", dot: "bg-amber-400", bg: "from-amber-900/50 to-orange-900/50" },
  completed: { label: "Completed", color: "text-gray-500", dot: "bg-gray-600", bg: "from-gray-800 to-gray-900" },
};

// Generate initials from event name (first letter of first 2 words)
function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

// Generate a consistent color based on event name
function getInitialsBgColor(name: string): string {
  const colors = [
    "from-purple-600 to-indigo-700",
    "from-blue-600 to-cyan-700",
    "from-emerald-600 to-teal-700",
    "from-amber-600 to-orange-700",
    "from-rose-600 to-pink-700",
    "from-violet-600 to-purple-700",
    "from-cyan-600 to-blue-700",
    "from-green-600 to-emerald-700",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

const ROLE_BADGE: Record<string, string> = {
  admin: "bg-purple-500/20 text-purple-300",
  organizer: "bg-blue-500/20 text-blue-300",
  auctioneer: "bg-amber-500/20 text-amber-300",
  captain: "bg-green-500/20 text-green-300",
  player: "bg-gray-500/20 text-gray-300",
};

// Priority order — highest priority role drives the primary CTA
const ROLE_PRIORITY = ["auctioneer", "captain", "organizer", "admin", "player"];

interface RoleAction {
  label: string;
  href: string;
}

function getRoleAction(role: string, eventId: number, status: string): RoleAction {
  switch (role) {
    case "auctioneer":
      return { label: "Control Panel", href: `/auction/${eventId}/auctioneer` };
    case "captain":
      return {
        label: status === "active" ? "Enter Bid Room" : "Captain View",
        href: `/auction/${eventId}/captain`,
      };
    case "organizer":
      return { label: "Setup Event", href: `/organizer/events/${eventId}` };
    case "admin":
      return { label: "Admin Settings", href: `/admin/events/${eventId}` };
    default:
      return {
        label: status === "active" ? "Watch Live" : "Event Info",
        href: `/auction/${eventId}/spectate`,
      };
  }
}

export default function EventCard({ event }: { event: EventCard }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const statusCfg = STATUS_CONFIG[event.status] ?? STATUS_CONFIG.draft;
  const myRoles = event.my_roles ?? [];

  // Sort roles by priority and pick the primary
  const sortedRoles = [...myRoles].sort(
    (a, b) => ROLE_PRIORITY.indexOf(a) - ROLE_PRIORITY.indexOf(b)
  );
  const primaryRole = sortedRoles[0] ?? null;
  const otherRoles = sortedRoles.slice(1);

  const primaryAction = primaryRole
    ? getRoleAction(primaryRole, event.id, event.status)
    : { label: "Spectate", href: `/auction/${event.id}/spectate` };

  const initials = getInitials(event.name);
  const initialsBg = getInitialsBgColor(event.name);

  return (
    <div className="group relative bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden hover:border-amber-500/40 transition-all hover:shadow-lg hover:shadow-amber-500/5 flex flex-col">
      {/* Hero section with logo/initials */}
      <div
        className={`relative h-28 bg-gradient-to-br ${statusCfg.bg} cursor-pointer`}
        onClick={() => router.push(primaryAction.href)}
      >
        {/* Logo or Initials */}
        <div className="absolute inset-0 flex items-center justify-center">
          {event.logo ? (
            <div className="w-20 h-20 rounded-2xl overflow-hidden bg-black/20 shadow-lg border border-white/10">
              <img src={event.logo} alt="" className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${initialsBg} flex items-center justify-center shadow-lg border border-white/10`}>
              <span className="text-3xl font-bold text-white/90 tracking-tight">{initials}</span>
            </div>
          )}
        </div>

        {/* Status badge - top right */}
        <div className={`absolute top-3 right-3 flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/40 backdrop-blur-sm ${statusCfg.color}`}>
          <span
            className={`w-2 h-2 rounded-full ${statusCfg.dot} ${
              event.status === "active" ? "animate-pulse" : ""
            }`}
          />
          <span className="text-xs font-medium">{statusCfg.label}</span>
        </div>

        {/* Live viewer count badge - top left for active events */}
        {event.status === "active" && (
          <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2 py-1 rounded-full bg-red-500/90 text-white text-xs font-medium">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            {event.viewer_count ?? 0} watching
          </div>
        )}
      </div>

      {/* Content section */}
      <div
        className="p-4 flex-1 flex flex-col cursor-pointer"
        onClick={() => router.push(primaryAction.href)}
      >
        {/* Event name */}
        <h3 className="font-bold text-base leading-snug text-center truncate group-hover:text-amber-400 transition-colors mb-1">
          {event.name}
        </h3>

        {/* Description */}
        <p className="text-gray-500 text-xs text-center line-clamp-1 mb-3">
          {event.description || "\u00A0"}
        </p>

        {/* Scheduled date */}
        {event.scheduled_at && (
          <div className="flex items-center justify-center gap-1.5 text-xs text-amber-400/90 mb-3">
            <span>📅</span>
            <span>
              {new Date(event.scheduled_at).toLocaleString("en-IN", {
                weekday: "short", day: "numeric", month: "short",
                hour: "2-digit", minute: "2-digit",
              })}
            </span>
          </div>
        )}

        {/* Stats row */}
        <div className="flex items-center justify-center gap-3 text-xs text-gray-500 mb-3">
          <span className="flex items-center gap-1">
            <span>🏟️</span>
            <span>{event.team_count}</span>
          </span>
          <span className="flex items-center gap-1">
            <span>👥</span>
            <span>{event.player_count}</span>
          </span>
          {event.status === "completed" && (
            <span className="flex items-center gap-1 text-blue-400">
              <span>👁</span>
              <span>{event.viewer_count ?? 0}</span>
            </span>
          )}
        </div>

        {/* Role pills */}
        <div className="flex items-center justify-center gap-1 flex-wrap mb-3">
          {myRoles.length === 0 && (
            <span className="text-xs text-gray-600">Spectator</span>
          )}
          {sortedRoles.map((role) => (
            <span
              key={role}
              className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
                ROLE_BADGE[role] ?? "bg-gray-700 text-gray-400"
              }`}
            >
              {role}
            </span>
          ))}
        </div>

        {/* Primary CTA */}
        <div className="mt-auto pt-2 border-t border-gray-800">
          <button
            className="w-full text-xs font-medium text-amber-400 hover:text-amber-300 py-2 flex items-center justify-center gap-1 group-hover:gap-2 transition-all"
            onClick={(e) => { e.stopPropagation(); router.push(primaryAction.href); }}
          >
            {primaryAction.label}
            <span className="transition-transform group-hover:translate-x-0.5">→</span>
          </button>
        </div>
      </div>

      {/* Multi-role switcher — only shown when user has 2+ roles in this event */}
      {otherRoles.length > 0 && (
        <div
          className="relative border-t border-gray-800"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full px-4 py-2 text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors flex items-center justify-center gap-1"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span>Switch role</span>
            <span className={`transition-transform ${menuOpen ? "rotate-180" : ""}`}>▾</span>
          </button>

          {menuOpen && (
            <div className="absolute bottom-full left-0 right-0 bg-gray-800 border border-gray-700 rounded-xl mb-1 shadow-xl overflow-hidden z-10">
              {/* Primary role first */}
              <button
                className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-700 transition-colors flex items-center gap-2"
                onClick={() => { setMenuOpen(false); router.push(primaryAction.href); }}
              >
                <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${ROLE_BADGE[primaryRole!] ?? ""}`}>
                  {primaryRole}
                </span>
                <span className="text-gray-400">{primaryAction.label}</span>
              </button>
              {/* Other roles */}
              {otherRoles.map((role) => {
                const action = getRoleAction(role, event.id, event.status);
                return (
                  <button
                    key={role}
                    className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-700 transition-colors flex items-center gap-2 border-t border-gray-700"
                    onClick={() => { setMenuOpen(false); router.push(action.href); }}
                  >
                    <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${ROLE_BADGE[role] ?? ""}`}>
                      {role}
                    </span>
                    <span className="text-gray-400">{action.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
