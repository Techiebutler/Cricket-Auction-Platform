"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import api from "@/lib/api";
import { useAuctionStore } from "@/store/auction";
import { AuctionSocket } from "@/lib/ws";

export default function SpectatePage() {
  const router = useRouter();
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
  const [historyFilter, setHistoryFilter] = useState<"all" | "sold" | "unsold">("all");
  const [historySort, setHistorySort] = useState<"price-desc" | "price-asc" | "name">("price-desc");

  const [eventMeta, setEventMeta] = useState<{ name: string; description: string | null; scheduled_at: string | null } | null>(null);

  const syncState = useCallback(async () => {
    const [stateRes, eventRes] = await Promise.all([
      api.get(`/auction/events/${eid}/state`),
      api.get(`/auction/events/${eid}`).catch(() => ({ data: null })),
    ]);
    const data = stateRes.data;
    store.setFullState({
      eventId: eid,
      status: data.status,
      timer: data.timer || 0,
      activePlayerId: data.active_player_id,
      teams: data.teams || [],
      players: data.players || [],
    });
    if (eventRes.data) {
      setEventMeta({
        name: eventRes.data.name,
        description: eventRes.data.description ?? null,
        scheduled_at: eventRes.data.scheduled_at ?? null,
      });
    }
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
      if (msg.type === "auction_completed") {
        store.setFullState({ status: "completed" });
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
  const pendingCount = pendingPlayers.length;

  const historyPlayers = store.players.filter(p => p.status === "sold" || p.status === "unsold");
  const filteredAndSortedHistory = historyPlayers
    .filter(p => historyFilter === "all" ? true : p.status === historyFilter)
    .sort((a, b) => {
      if (historySort === "name") {
        const nameA = playerNames[a.player_id] || "";
        const nameB = playerNames[b.player_id] || "";
        return nameA.localeCompare(nameB);
      }
      const priceA = a.status === "sold" ? a.current_bid : 0;
      const priceB = b.status === "sold" ? b.current_bid : 0;
      return historySort === "price-desc" ? priceB - priceA : priceA - priceB;
    });

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/dashboard")}
            className="text-gray-500 hover:text-white flex items-center justify-center w-8 h-8 rounded-full hover:bg-gray-800 transition-colors"
            title="Exit to Dashboard"
          >
            ←
          </button>
          <span className="text-3xl">🏏</span>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-extrabold bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
                Cricket Auction LIVE
              </h1>
              {store.status === "completed" && (
                <span className="bg-green-500/20 text-green-400 text-xs font-semibold px-2 py-1 rounded">
                  COMPLETED
                </span>
              )}
            </div>
            {eventMeta && (
              <p className="text-xs text-gray-500">
                {eventMeta.name}
                {eventMeta.scheduled_at && store.status !== "completed" && (
                  <>
                    {" · "}
                    {new Date(eventMeta.scheduled_at).toLocaleString("en-IN", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </>
                )}
              </p>
            )}
          </div>
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
          <div className="text-right text-xs">
            <p
              className={`font-semibold ${
                store.status === "active"
                  ? "text-green-400"
                  : store.status === "paused"
                  ? "text-amber-400"
                  : store.status === "completed"
                  ? "text-blue-400"
                  : "text-gray-500"
              }`}
            >
              {store.status === "active"
                ? "Live"
                : store.status === "paused"
                ? "Paused"
                : store.status === "completed"
                ? "Finished"
                : "Not started"}
            </p>
            <div
              className={`w-3 h-3 rounded-full mt-1 ${
                store.status === "active"
                  ? "bg-green-400 animate-pulse"
                  : store.status === "paused"
                  ? "bg-amber-400"
                  : store.status === "completed"
                  ? "bg-blue-500"
                  : "bg-red-500"
              }`}
            />
          </div>
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
                <div className="w-24 h-24 rounded-full bg-gray-800 overflow-hidden mb-3 flex items-center justify-center text-3xl border-2 border-gray-700">
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
                <p className="text-gray-500 font-medium">Base Price: ₹{activeAP.base_price}</p>
              </div>

              {/* Current bid */}
              <div className="bg-gray-900 border-2 border-amber-500/40 rounded-2xl p-8 mb-6 shadow-[0_0_40px_-10px_rgba(251,191,36,0.15)]">
                <p className="text-gray-400 text-sm uppercase tracking-widest mb-2 font-semibold">Current Bid</p>
                <p className="text-7xl font-extrabold text-amber-400">
                  ₹{activeAP.current_bid > 0 ? activeAP.current_bid : activeAP.base_price}
                </p>
                {lastBidInfo && (
                  <p className="text-xl text-gray-300 mt-3">
                    by <span className="font-bold text-white bg-gray-800 px-3 py-1 rounded-lg ml-2">{lastBidInfo.name}</span>
                  </p>
                )}
              </div>

              {/* Bid history toggle */}
              {bidHistory.length > 0 && (
                <div className="mt-4 text-left max-w-xl mx-auto">
                  <button
                    className="text-xs text-gray-400 hover:text-amber-400 flex items-center gap-1 transition-colors bg-gray-900/50 px-3 py-1.5 rounded-full mx-auto"
                    onClick={() => setShowHistory((v) => !v)}
                  >
                    <span>{showHistory ? "Hide" : "Show"} bid history</span>
                    <span>{showHistory ? "▴" : "▾"}</span>
                  </button>
                  {showHistory && (
                    <div className="mt-3 max-h-40 overflow-y-auto text-xs bg-gray-900 border border-gray-800 rounded-xl p-3 space-y-1.5">
                      {bidHistory.map((b) => (
                        <div key={b.id} className="flex justify-between items-center py-1 border-b border-gray-800 last:border-0">
                          <span className="text-gray-300 truncate max-w-[55%]">{b.name}</span>
                          <span className="text-amber-300 font-medium">₹{b.amount}</span>
                          <span className="text-gray-500 text-[10px]">{b.time}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center max-w-lg w-full">
              <div className="text-8xl mb-6">🏟️</div>
              <h2 className="text-3xl font-bold text-white mb-3">
                {store.status === "completed"
                  ? "Auction Completed"
                  : store.status === "active"
                  ? "Waiting for next player..."
                  : store.status === "paused"
                  ? "Auction is paused"
                  : "Auction not started yet"}
              </h2>
              {store.status === "completed" && (
                <p className="text-gray-400">All players have been auctioned.</p>
              )}
              {eventMeta?.description && (
                <p className="text-sm text-gray-500 mt-4 max-w-md mx-auto leading-relaxed">
                  {eventMeta.description}
                </p>
              )}
              {store.status !== "completed" && store.status !== "active" && eventMeta?.scheduled_at && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mt-8">
                  <p className="text-sm text-gray-400 uppercase tracking-widest font-semibold mb-2">Event Schedule</p>
                  <p className="text-xl font-medium text-amber-400">
                    {new Date(eventMeta.scheduled_at).toLocaleString("en-IN", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </p>
                  <p className="text-3xl font-bold text-white mt-1">
                    {new Date(eventMeta.scheduled_at).toLocaleString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

          {/* Side panel - Teams & Players */}
          <aside className="w-80 bg-gray-900 border-l border-gray-800 p-4 overflow-y-auto">
          {/* Combined Team Standings & Rosters */}
          <h3 className="text-sm font-semibold text-gray-400 uppercase mb-4">Teams</h3>
          <div className="space-y-3">
            {store.teams.map((team) => {
              const remaining = team.budget - team.spent;
              const pct = team.budget > 0 ? (team.spent / team.budget) * 100 : 0;
              const roster = teamRosters[team.id] ?? [];
              
              return (
                <details key={team.id} className="bg-gray-800 rounded-xl overflow-hidden group">
                  <summary className="cursor-pointer p-3 hover:bg-gray-750 transition-colors list-none">
                    <div className="flex justify-between items-center mb-2">
                      <p className="font-semibold text-sm">{team.name}</p>
                      <span className="text-xs text-gray-500">{team.player_count}/{team.max_players}</span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-1.5 mb-2">
                      <div
                        className="bg-amber-500 h-1.5 rounded-full transition-all"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <div className="flex gap-3 text-gray-500">
                        <span>Spent: {team.spent}</span>
                        <span className={remaining < 200 ? "text-red-400" : "text-green-400"}>
                          Left: {remaining}
                        </span>
                      </div>
                      <div className="w-5 h-5 flex items-center justify-center rounded-full bg-gray-800 border border-gray-700 text-gray-400 group-open:rotate-180 transition-transform duration-300">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                      </div>
                    </div>
                  </summary>
                  
                  {/* Team Roster inside expandable */}
                  <div className="px-3 pb-3 pt-1 border-t border-gray-700">
                    <p className="text-[10px] uppercase text-gray-500 mb-2 font-semibold">Squad</p>
                    {roster.length > 0 ? (
                      <div className="space-y-1.5">
                        {roster.map((tp, idx) => (
                          <div key={idx} className="flex justify-between items-center text-xs bg-gray-900 rounded px-2 py-1.5">
                            <span className="text-gray-300 truncate">
                              {playerNames[tp.player_id] || `Player #${tp.player_id}`}
                            </span>
                            <span className="text-amber-400 font-semibold">₹{tp.sold_price}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray-600 text-[11px] italic">No players yet</p>
                    )}
                  </div>
                </details>
              );
            })}
          </div>

          {/* Auction History (Filterable & Sortable) */}
          <div className="mt-8 pt-6 border-t border-gray-800">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
                Auction History
              </h3>
            </div>
            
            {/* Controls */}
            <div className="flex items-center gap-2 mb-4">
              <select
                className="bg-gray-800 border border-gray-700 text-xs text-gray-300 rounded-lg px-2 py-1.5 outline-none focus:border-amber-500/50 flex-1"
                value={historyFilter}
                onChange={(e) => setHistoryFilter(e.target.value as any)}
              >
                <option value="all">All Status</option>
                <option value="sold">Sold</option>
                <option value="unsold">Unsold</option>
              </select>
              <select
                className="bg-gray-800 border border-gray-700 text-xs text-gray-300 rounded-lg px-2 py-1.5 outline-none focus:border-amber-500/50 flex-1"
                value={historySort}
                onChange={(e) => setHistorySort(e.target.value as any)}
              >
                <option value="price-desc">Price: High to Low</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="name">Name (A-Z)</option>
              </select>
            </div>

            {/* List */}
            <div className="space-y-2">
              {filteredAndSortedHistory.length === 0 ? (
                <p className="text-xs text-gray-500 text-center py-4 bg-gray-800/50 rounded-xl">No players found</p>
              ) : (
                  filteredAndSortedHistory.map((p) => {
                    // Find team if sold
                    let teamName = null;
                    if (p.status === "sold") {
                      for (const [teamIdStr, roster] of Object.entries(teamRosters)) {
                        if (roster.some(tp => tp.player_id === p.player_id)) {
                          const tId = parseInt(teamIdStr);
                          teamName = store.teams.find(t => t.id === tId)?.name;
                          break;
                        }
                      }
                    }

                    return (
                      <div key={p.id} className="flex items-center justify-between bg-gray-800 rounded-xl p-3">
                        <div className="flex flex-col">
                          <span className="text-sm text-gray-200 font-medium">
                            {playerNames[p.player_id] || `#${p.player_id}`}
                          </span>
                          {teamName && (
                            <span className="text-[10px] text-gray-500">{teamName}</span>
                          )}
                        </div>
                        {p.status === "unsold" ? (
                          <span className="text-red-400 text-[10px] font-semibold px-2 py-1 bg-red-500/10 rounded tracking-wider">
                            UNSOLD
                          </span>
                        ) : (
                          <span className="text-green-400 font-semibold tracking-wide">
                            ₹{p.current_bid}
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
        </aside>
      </div>
    </div>
  );
}
