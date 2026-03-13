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

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  draft: { label: "Draft", color: "text-gray-400", dot: "bg-gray-500" },
  ready: { label: "Ready", color: "text-blue-400", dot: "bg-blue-500" },
  active: { label: "Live", color: "text-green-400", dot: "bg-green-400" },
  paused: { label: "Paused", color: "text-amber-400", dot: "bg-amber-400" },
  completed: { label: "Completed", color: "text-gray-500", dot: "bg-gray-600" },
};

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

  return (
    <div className="group relative bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden hover:border-amber-500/40 transition-all hover:shadow-lg hover:shadow-amber-500/5">
      {/* Top color bar */}
      <div
        className={`h-1 w-full ${
          event.status === "active"
            ? "bg-gradient-to-r from-green-500 to-emerald-400"
            : event.status === "ready"
            ? "bg-gradient-to-r from-blue-500 to-indigo-400"
            : event.status === "completed"
            ? "bg-gray-700"
            : "bg-gradient-to-r from-amber-500 to-orange-400"
        }`}
      />

      {/* Clickable body — navigates to primary action */}
      <div
        className="p-5 cursor-pointer"
        onClick={() => router.push(primaryAction.href)}
      >
        {/* Header row */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* Event Logo */}
            {event.logo && (
              <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-800 shrink-0">
                <img src={event.logo} alt="" className="w-full h-full object-cover" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-lg leading-snug truncate group-hover:text-amber-400 transition-colors">
                {event.name}
              </h3>
              <p className="text-gray-500 text-sm mt-0.5 line-clamp-1 h-5 overflow-hidden">
                {event.description || "\u00A0"}
              </p>
            </div>
          </div>
          <div className={`flex items-center gap-1.5 shrink-0 ${statusCfg.color}`}>
            <span
              className={`w-2 h-2 rounded-full ${statusCfg.dot} ${
                event.status === "active" ? "animate-pulse" : ""
              }`}
            />
            <span className="text-xs font-medium">{statusCfg.label}</span>
          </div>
        </div>

        {/* Scheduled date */}
        {event.scheduled_at && (
          <div className="flex items-center gap-1.5 text-xs text-amber-400/90 mb-3">
            <span>📅</span>
            <span>
              {new Date(event.scheduled_at).toLocaleString("en-IN", {
                weekday: "short", day: "numeric", month: "short",
                year: "numeric", hour: "2-digit", minute: "2-digit",
              })}
            </span>
          </div>
        )}

        {/* Stats */}
        <div className="flex items-center gap-4 text-sm text-gray-500 mb-4">
          <span className="flex items-center gap-1">
            <span>🏟️</span>
            <span>{event.team_count} teams</span>
          </span>
          <span className="flex items-center gap-1">
            <span>👥</span>
            <span>{event.player_count} players</span>
          </span>
          {(event.status === "active" || event.status === "completed") && (
            <span className="flex items-center gap-1 text-blue-400">
              <span>👁</span>
              <span>{event.viewer_count ?? 0} {event.status === "completed" ? "watched" : "watching"}</span>
            </span>
          )}
        </div>

        {/* Footer: role badges + primary CTA */}
        <div className="flex items-center justify-between">
          {/* Role pills */}
          <div className="flex items-center gap-1 flex-wrap">
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

          <span className="text-xs font-medium text-amber-400 group-hover:translate-x-1 transition-transform shrink-0 ml-2">
            {primaryAction.label} →
          </span>
        </div>
      </div>

      {/* Multi-role switcher — only shown when user has 2+ roles in this event */}
      {otherRoles.length > 0 && (
        <div
          className="relative border-t border-gray-800"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full px-5 py-2 text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors flex items-center justify-between"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span>Open as different role</span>
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
