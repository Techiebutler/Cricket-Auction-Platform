"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import api from "@/lib/api";
import { useAuctionStore } from "@/store/auction";
import { AuctionSocket } from "@/lib/ws";

export default function SpectatePage() {
  const { eventId } = useParams<{ eventId: string }>();
  const eid = parseInt(eventId);
  const store = useAuctionStore();
  const [playerNames, setPlayerNames] = useState<Record<number, string>>({});
  const [playerPhotos, setPlayerPhotos] = useState<Record<number, string | null>>({});
  const [lastBidInfo, setLastBidInfo] = useState<{ name: string; amount: number } | null>(null);
  const [bidHistory, setBidHistory] = useState<
    { id: number; name: string; amount: number; time: string }[]
  >([]);
  const [showHistory, setShowHistory] = useState(false);
  const [teamRosters, setTeamRosters] = useState<
    Record<number, { player_id: number; sold_price: number }[]>
  >({});
  const [showUnsold, setShowUnsold] = useState(false);

  const syncState = useCallback(async () => {
    const { data } = await api.get(`/auction/events/${eid}/state`);
    store.setFullState({
      eventId: eid,
      status: data.status,
      timer: data.timer || 0,
      activePlayerId: data.active_player_id,
      teams: data.teams || [],
      players: data.players || [],
    });
  }, [eid]);

  useEffect(() => {
    syncState();

    const token = localStorage.getItem("token") || "";
    const ws = new AuctionSocket(eid, token);
    ws.connect();

    ws.on("*", (msg) => {
      if (msg.type === "timer_tick") store.setTimer(msg.remaining as number);
      if (msg.type === "new_bid") {
        store.updateBid(msg.auction_player_id as number, msg.amount as number, msg.captain_id as number);
        const amount = msg.amount as number;
        const name =
          playerNames[msg.captain_id as number] || `Captain #${msg.captain_id}`;
        const time = new Date().toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
        setLastBidInfo({ name, amount });
        setBidHistory((prev) =>
          [{ id: Date.now(), name, amount, time }, ...prev].slice(0, 20)
        );
      }
      if (msg.type === "player_sold") {
        store.markPlayerSold(msg.auction_player_id as number, msg.sold_to_captain_id as number, msg.sold_price as number);
      }
      if (msg.type === "player_unsold") {
        store.markPlayerUnsold(msg.auction_player_id as number);
        setLastBidInfo(null);
      }
      if (msg.type === "player_up") {
        store.setActivePlayer(msg.auction_player_id as number, msg.base_price as number);
        setLastBidInfo(null);
      }
      if (msg.type === "auction_resumed") {
        store.setFullState({ status: "active" });
      }
      if (msg.type === "auction_paused") {
        store.setFullState({ status: "paused" });
      }
    });

    api.get(`/auction/events/${eid}/players-info`).then(({ data }) => {
      const names: Record<number, string> = {};
      const photos: Record<number, string | null> = {};
      data.forEach(
        (row: { player_id: number; name: string; profile_photo: string | null }) => {
          names[row.player_id] = row.name;
          photos[row.player_id] = row.profile_photo;
        }
      );
      setPlayerNames(names);
      setPlayerPhotos(photos);
    }).catch(() => {});

    api.get(`/auction/events/${eid}/teams`).then(({ data }) => {
      const map: Record<number, { player_id: number; sold_price: number }[]> = {};
      data.forEach(
        (t: { id: number; players: { player_id: number; sold_price: number }[] }) => {
          map[t.id] = t.players;
        }
      );
      setTeamRosters(map);
    }).catch(() => {});

    return () => ws.disconnect();
  }, [eid]);

  const activeAP = store.players.find((p) => p.id === store.activePlayerId);
  const timer = store.timer;
  const timerColor = timer > 30 ? "text-green-400" : timer > 10 ? "text-amber-400" : "text-red-400 animate-pulse";
  const soldPlayers = store.players.filter((p) => p.status === "sold");
  const pendingPlayers = store.players.filter((p) => p.status === "pending");
  const unsoldPlayers = store.players.filter((p) => p.status === "unsold");
  const pendingCount = pendingPlayers.length;

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-3xl">🏏</span>
          <h1 className="text-2xl font-extrabold bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
            Cricket Auction LIVE
          </h1>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-center">
            <p className="text-amber-400 font-bold text-xl">{pendingCount}</p>
            <p className="text-xs text-gray-500">Remaining</p>
          </div>
          <div className="text-center">
            <p className="text-green-400 font-bold text-xl">{soldPlayers.length}</p>
            <p className="text-xs text-gray-500">Sold</p>
          </div>
          <div className={`w-3 h-3 rounded-full ${store.status === "active" ? "bg-green-400 animate-pulse" : "bg-red-500"}`} />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Main stage */}
        <div className="flex-1 flex flex-col items-center justify-center p-10">
          {activeAP ? (
            <div className="text-center max-w-2xl w-full">
              {/* Timer */}
              <div className={`text-9xl font-mono font-black mb-6 ${timerColor}`}>
                {timer.toString().padStart(2, "0")}
              </div>

              {/* Player avatar + name */}
              <div className="flex flex-col items-center mb-6">
                <div className="w-24 h-24 rounded-full bg-gray-800 overflow-hidden mb-3 flex items-center justify-center text-3xl">
                  {playerPhotos[activeAP.player_id] ? (
                    <img
                      src={playerPhotos[activeAP.player_id] as string}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span>👤</span>
                  )}
                </div>
                <h2 className="text-5xl font-extrabold mb-1">
                  {playerNames[activeAP.player_id] || `Player #${activeAP.player_id}`}
                </h2>
                <p className="text-gray-500">Base Price: {activeAP.base_price}</p>
              </div>

              {/* Current bid */}
              <div className="bg-gray-900 border-2 border-amber-500/40 rounded-2xl p-8 mb-6">
                <p className="text-gray-400 text-sm uppercase tracking-widest mb-2">Current Bid</p>
                <p className="text-7xl font-extrabold text-amber-400">
                  {activeAP.current_bid > 0 ? activeAP.current_bid : activeAP.base_price}
                </p>
                {lastBidInfo && (
                  <p className="text-xl text-gray-300 mt-3">
                    by <span className="font-bold text-white">{lastBidInfo.name}</span>
                  </p>
                )}
              </div>

              {/* Bid history toggle */}
              {bidHistory.length > 0 && (
                <div className="mt-4 text-left max-w-xl mx-auto">
                  <button
                    className="text-xs text-gray-400 hover:text-amber-400 flex items-center gap-1"
                    onClick={() => setShowHistory((v) => !v)}
                  >
                    <span>{showHistory ? "Hide" : "Show"} bid history</span>
                    <span>{showHistory ? "▴" : "▾"}</span>
                  </button>
                  {showHistory && (
                    <div className="mt-2 max-h-40 overflow-y-auto text-xs bg-gray-900 border border-gray-800 rounded-xl p-3 space-y-1">
                      {bidHistory.map((b) => (
                        <div key={b.id} className="flex justify-between">
                          <span className="text-gray-300 truncate max-w-[55%]">{b.name}</span>
                          <span className="text-amber-300">{b.amount}</span>
                          <span className="text-gray-500">{b.time}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center">
              <div className="text-8xl mb-6">🏟️</div>
              <h2 className="text-3xl font-bold text-gray-400">
                {store.status === "active" ? "Waiting for next player..." : "Auction not started yet"}
              </h2>
            </div>
          )}
        </div>

          {/* Side panel - Teams, unsold, sold */}
          <aside className="w-80 bg-gray-900 border-l border-gray-800 p-4 overflow-y-auto">
          <h3 className="text-sm font-semibold text-gray-400 uppercase mb-4">Team Standings</h3>
          <div className="space-y-3">
            {store.teams.map((team) => {
              const remaining = team.budget - team.spent;
              const pct = team.budget > 0 ? (team.spent / team.budget) * 100 : 0;
              return (
                <div key={team.id} className="bg-gray-800 rounded-xl p-3">
                  <div className="flex justify-between items-center mb-2">
                    <p className="font-semibold text-sm">{team.name}</p>
                    <span className="text-xs text-gray-500">{team.player_count}/{team.max_players}</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-1.5 mb-1">
                    <div
                      className="bg-amber-500 h-1.5 rounded-full"
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Spent: {team.spent}</span>
                    <span className={remaining < 200 ? "text-red-400" : "text-green-400"}>
                      Left: {remaining}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Unsold expandable */}
          {unsoldPlayers.length > 0 && (
            <div className="mt-6">
              <button
                className="flex items-center justify-between w-full text-sm font-semibold text-gray-400 uppercase mb-2"
                onClick={() => setShowUnsold((v) => !v)}
              >
                <span>Unsold ({unsoldPlayers.length})</span>
                <span>{showUnsold ? "▴" : "▾"}</span>
              </button>
              {showUnsold && (
                <div className="space-y-1 text-xs">
                  {unsoldPlayers.map((p) => (
                    <div key={p.id} className="flex items-center justify-between">
                      <span className="text-gray-300 truncate">
                        {playerNames[p.player_id] || `#${p.player_id}`}
                      </span>
                      <span className="badge-unsold">Unsold</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Recent sold */}
          {soldPlayers.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-gray-400 uppercase mb-2">
                Recently Sold
              </h3>
              <div className="space-y-2 text-xs">
                {soldPlayers.slice(-5).reverse().map((p) => (
                  <div key={p.id} className="flex items-center justify-between">
                    <span className="text-gray-300 truncate">
                      {playerNames[p.player_id] || `#${p.player_id}`}
                    </span>
                    <span className="badge-sold">{p.current_bid}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Team rosters (quick peek) */}
          {Object.keys(teamRosters).length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-gray-400 uppercase mb-2">
                Team Rosters
              </h3>
              <div className="space-y-2 text-xs">
                {store.teams.map((team) => (
                  <details key={team.id} className="bg-gray-800 rounded-lg px-3 py-2">
                    <summary className="cursor-pointer flex justify-between items-center">
                      <span>{team.name}</span>
                      <span className="text-gray-500 text-[11px]">
                        {team.player_count}/{team.max_players}
                      </span>
                    </summary>
                    <div className="mt-2 space-y-1">
                      {(teamRosters[team.id] ?? []).map((tp, idx) => (
                        <div key={idx} className="flex justify-between">
                          <span className="text-gray-300 truncate">
                            {playerNames[tp.player_id] || `#${tp.player_id}`}
                          </span>
                          <span className="badge-sold">{tp.sold_price}</span>
                        </div>
                      ))}
                      {(!teamRosters[team.id] || teamRosters[team.id].length === 0) && (
                        <p className="text-gray-600 text-[11px]">No players yet.</p>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
