"use client";

import { TeamState } from "@/store/auction";

function isDark(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

interface Props {
  teams: TeamState[];
  highlightCaptainId?: number | null;
  teamRosters?: Record<number, { player_id: number; sold_price: number }[]>;
  playerNames?: Record<number, string>;
}

export default function TeamSummary({ teams, highlightCaptainId, teamRosters = {}, playerNames = {} }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {teams.map((team) => {
        const remaining = team.budget - team.spent;
        const pct = team.budget > 0 ? (team.spent / team.budget) * 100 : 0;
        const isHighlighted = team.captain_id === highlightCaptainId;
        const color = team.color || "#3B82F6";
        const textColor = isDark(color) ? "white" : "#111827";
        const roster = teamRosters[team.id] || [];

        return (
          <details
            key={team.id}
            className={`rounded-xl overflow-hidden border-2 transition-all group ${
              isHighlighted ? "border-white/40 scale-[1.02]" : "border-transparent"
            }`}
          >
            <summary className="list-none cursor-pointer">
              {/* Color header */}
              <div className="px-3 py-2" style={{ backgroundColor: color }}>
                <p className="font-bold text-sm truncate" style={{ color: textColor }}>
                  {team.name}
                </p>
                <p className="text-xs" style={{ color: isDark(color) ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.5)" }}>
                  {team.player_count}/{team.max_players} players
                </p>
              </div>

              {/* Budget bar */}
              <div className="bg-gray-900 px-3 py-2">
                <div className="w-full bg-gray-800 rounded-full h-1.5 mb-1.5">
                  <div
                    className="h-1.5 rounded-full transition-all"
                    style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }}
                  />
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-500">Spent: {team.spent}</span>
                  <div className="flex items-center gap-2">
                    <span className={remaining < team.budget * 0.2 ? "text-red-400" : "text-green-400"}>
                      Left: {remaining}
                    </span>
                    <span className="text-gray-500 group-open:rotate-180 transition-transform duration-200">▾</span>
                  </div>
                </div>
              </div>
            </summary>
            <div className="bg-gray-900 border-t border-gray-800 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-2">Players</p>
              {roster.length === 0 ? (
                <p className="text-xs text-gray-600 italic">No players yet</p>
              ) : (
                <div className="space-y-1 max-h-28 overflow-y-auto pr-1 custom-scrollbar">
                  {roster.map((rp, idx) => (
                    <div key={`${team.id}-${rp.player_id}-${idx}`} className="flex items-center justify-between text-xs bg-gray-800/70 rounded px-2 py-1">
                      <span className="text-gray-300 truncate">{playerNames[rp.player_id] || `Player #${rp.player_id}`}</span>
                      <span className="text-amber-400 font-medium">₹{rp.sold_price}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}
