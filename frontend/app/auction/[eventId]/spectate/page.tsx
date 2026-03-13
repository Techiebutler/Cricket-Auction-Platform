"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import api from "@/lib/api";
import { useAuctionStore } from "@/store/auction";
import { AuctionSocket } from "@/lib/ws";
import brandLogo from "@/asset/Logo Png (3).png";

interface CompletedSummary {
  highest_bid_player: { player_name: string; sold_price: number; team_name: string } | null;
  strongest_team: {
    team_name: string;
    overall_rating: number;
    batting_avg: number;
    bowling_avg: number;
    fielding_avg: number;
    player_count: number;
  } | null;
  teams: {
    team_id: number;
    team_name: string;
    spent: number;
    remaining: number;
    player_count: number;
    players: { player_id: number; name: string; sold_price: number; rating_score: number }[];
  }[];
  unsold_players: { player_id: number; name: string; base_price: number; last_bid: number }[];
  stats: { total_players: number; sold_count: number; unsold_count: number };
}

export default function SpectatePage() {
  const router = useRouter();
  const { eventId } = useParams<{ eventId: string }>();
  const eid = parseInt(eventId);
  const store = useAuctionStore();
  const [playerNames, setPlayerNames] = useState<Record<number, string>>({});
  const [playerPhotos, setPlayerPhotos] = useState<Record<number, string | null>>({});
  const [lastBidInfo, setLastBidInfo] = useState<{ captain_id: number; amount: number } | null>(null);
  const [bidHistory, setBidHistory] = useState<
    { id: number; auction_player_id: number; captain_id: number; amount: number; time: string }[]
  >([]);
  const [showHistory, setShowHistory] = useState(false);
  const [teamRosters, setTeamRosters] = useState<
    Record<number, { player_id: number; sold_price: number }[]>
  >({});
  const [historyFilter, setHistoryFilter] = useState<"all" | "pending" | "sold" | "unsold">("all");
  const [historySort, setHistorySort] = useState<"price-desc" | "price-asc" | "name">("price-desc");
  const [teamFilter, setTeamFilter] = useState<string>("all");

  const [eventMeta, setEventMeta] = useState<{ name: string; description: string | null; scheduled_at: string | null } | null>(null);
  const [lastShownAuctionPlayerId, setLastShownAuctionPlayerId] = useState<number | null>(null);
  const [completedSummary, setCompletedSummary] = useState<CompletedSummary | null>(null);
  const [viewerCount, setViewerCount] = useState<number>(0);

  const syncState = useCallback(async () => {
    const [stateRes, eventRes, teamRes] = await Promise.all([
      api.get(`/auction/events/${eid}/state`),
      api.get(`/auction/events/${eid}`).catch(() => ({ data: null })),
      api.get(`/auction/events/${eid}/teams`).catch(() => ({ data: [] })),
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
    if (data.active_player_id) {
      setLastShownAuctionPlayerId(data.active_player_id);
    }
    if (eventRes.data) {
      setEventMeta({
        name: eventRes.data.name,
        description: eventRes.data.description ?? null,
        scheduled_at: eventRes.data.scheduled_at ?? null,
      });
    }
    if (teamRes.data) {
      const map: Record<number, { player_id: number; sold_price: number }[]> = {};
      teamRes.data.forEach(
        (t: { id: number; players: { player_id: number; sold_price: number }[] }) => {
          map[t.id] = t.players;
        }
      );
      setTeamRosters(map);
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
        const auction_player_id = msg.auction_player_id as number;
        const amount = msg.amount as number;
        const captain_id = msg.captain_id as number;
        const time = new Date().toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
        setLastBidInfo({ captain_id, amount });
        setBidHistory((prev) => {
          const top = prev[0];
          // Guard against duplicate websocket delivery for the same bid event.
          if (
            top &&
            top.auction_player_id === auction_player_id &&
            top.captain_id === captain_id &&
            top.amount === amount
          ) {
            return prev;
          }
          return [{ id: Date.now(), auction_player_id, captain_id, amount, time }, ...prev].slice(0, 20);
        });
      }
      if (msg.type === "player_sold") {
        store.markPlayerSold(msg.auction_player_id as number, msg.sold_to_captain_id as number, msg.sold_price as number);
        syncState();
      }
      if (msg.type === "player_unsold") {
        store.markPlayerUnsold(msg.auction_player_id as number);
        setLastBidInfo(null);
      }
      if (msg.type === "player_up") {
        store.setActivePlayer(msg.auction_player_id as number, msg.base_price as number);
        setLastShownAuctionPlayerId(msg.auction_player_id as number);
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
      if (msg.type === "viewer_count") {
        setViewerCount(msg.count as number);
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

    return () => ws.disconnect();
  }, [eid]);

  const activeAP = store.players.find((p) => p.id === store.activePlayerId);
  const displayAP =
    activeAP ||
    (lastShownAuctionPlayerId
      ? store.players.find((p) => p.id === lastShownAuctionPlayerId)
      : undefined);
  const timer = store.timer;
  const timerColor = timer > 30 ? "text-green-400" : timer > 10 ? "text-amber-400" : "text-red-400 animate-pulse";
  const captainIds = new Set(
    store.teams
      .map((t) => t.captain_id)
      .filter((id): id is number => id !== null)
  );
  const soldPlayers = store.players.filter((p) => p.status === "sold");
  const pendingPlayers = store.players.filter(
    (p) => p.status === "pending" && !captainIds.has(p.player_id)
  );
  const unsoldPlayers = store.players.filter((p) => p.status === "unsold");
  const pendingCount = pendingPlayers.length;

  const getTeamName = (captainId: number) => {
    const team = store.teams.find((t) => t.captain_id === captainId);
    return team ? team.name : playerNames[captainId] || `Captain #${captainId}`;
  };

  const getTeamNameForPlayer = (playerId: number): string | null => {
    for (const [teamIdStr, roster] of Object.entries(teamRosters)) {
      if (roster.some((tp) => tp.player_id === playerId)) {
        const tId = parseInt(teamIdStr, 10);
        return store.teams.find((t) => t.id === tId)?.name || null;
      }
    }
    return null;
  };

  const allPlayersFiltered = store.players
    .filter((p) => {
      const isCaptainPending = p.status === "pending" && captainIds.has(p.player_id);
      if (isCaptainPending) return false;
      const statusOk = historyFilter === "all" ? true : p.status === historyFilter;
      if (!statusOk) return false;

      if (teamFilter === "all") return true;
      const teamName = getTeamNameForPlayer(p.player_id);
      if (teamFilter === "unassigned") return teamName === null;
      return teamName === teamFilter;
    })
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
  const currentPlayerBidHistory = displayAP
    ? bidHistory.filter((b) => b.auction_player_id === displayAP.id)
    : [];

  useEffect(() => {
    setShowHistory(false);
  }, [displayAP?.id]);

  useEffect(() => {
    if (store.status !== "completed") {
      setCompletedSummary(null);
      return;
    }
    api.get(`/auction/events/${eid}/summary`)
      .then(({ data }) => setCompletedSummary(data as CompletedSummary))
      .catch(() => setCompletedSummary(null));
  }, [eid, store.status]);

  return (
    <div className="h-screen bg-gray-950 flex flex-col">
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
          <Image src={brandLogo} alt="Cricket Auction" className="h-9 w-auto" />
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
            <p className="text-blue-400 font-bold text-xl">{viewerCount}</p>
            <p className="text-xs text-gray-500">{store.status === "completed" ? "Watched" : "Watching"}</p>
          </div>
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
        <div className="flex-1 flex flex-col items-center justify-center p-10 overflow-y-auto">
          {displayAP ? (
            <div className="text-center max-w-2xl w-full">
              {/* Timer */}
              <div className={`text-9xl font-mono font-black mb-6 ${timerColor}`}>
                {timer.toString().padStart(2, "0")}
              </div>

              {/* Player avatar + name */}
              <div className="flex flex-col items-center mb-6">
                <div className="w-24 h-24 rounded-full bg-gray-800 overflow-hidden mb-3 flex items-center justify-center text-3xl border-2 border-gray-700">
                  {playerPhotos[displayAP.player_id] ? (
                    <img
                      src={playerPhotos[displayAP.player_id] as string}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span>👤</span>
                  )}
                </div>
                <h2 className="text-5xl font-extrabold mb-1">
                  {playerNames[displayAP.player_id] || `Player #${displayAP.player_id}`}
                </h2>
                <p className="text-gray-500 font-medium">Base Price: ₹{displayAP.base_price}</p>
              </div>

              {displayAP.status === "sold" || displayAP.status === "unsold" ? (
                <div className={`relative overflow-hidden rounded-2xl border-2 p-8 mb-6 text-center shadow-[0_0_40px_-10px_rgba(251,191,36,0.15)] ${
                  displayAP.status === "sold"
                    ? "bg-green-500/10 border-green-500/40"
                    : "bg-red-500/10 border-red-500/40"
                }`}>
                  {displayAP.status === "sold" && (
                    <div className="absolute inset-0 pointer-events-none">
                      <div className="absolute -top-2 left-6 text-2xl animate-bounce">🎉</div>
                      <div className="absolute -top-2 right-8 text-2xl animate-bounce [animation-delay:120ms]">✨</div>
                    </div>
                  )}
                  {displayAP.status === "unsold" && (
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                      <div className="text-red-400/20 text-[120px] font-black leading-none select-none animate-pulse">✕</div>
                    </div>
                  )}
                  <p className="text-gray-400 text-sm uppercase tracking-widest mb-2 font-semibold">Result</p>
                  <p className={`text-5xl font-extrabold ${displayAP.status === "sold" ? "text-green-300" : "text-red-300"}`}>
                    {displayAP.status === "sold" ? "SOLD!" : "UNSOLD"}
                  </p>
                  <p className="text-sm text-gray-300 mt-3">
                    {displayAP.status === "sold"
                      ? `${playerNames[displayAP.player_id] || `Player #${displayAP.player_id}`} sold to ${getTeamName(displayAP.current_bidder_id as number)} for ₹${displayAP.current_bid}`
                      : `${playerNames[displayAP.player_id] || `Player #${displayAP.player_id}`} remains UNSOLD.`}
                  </p>
                  <p className="text-xs text-gray-500 mt-2">Waiting for auctioneer to move next player...</p>
                </div>
              ) : (
                <div className="bg-gray-900 border-2 border-amber-500/40 rounded-2xl p-8 mb-6 shadow-[0_0_40px_-10px_rgba(251,191,36,0.15)]">
                  <p className="text-gray-400 text-sm uppercase tracking-widest mb-2 font-semibold">Current Bid</p>
                  <p className="text-7xl font-extrabold text-amber-400">
                    ₹{displayAP.current_bid > 0 ? displayAP.current_bid : displayAP.base_price}
                  </p>
                  {lastBidInfo && (
                    <p className="text-xl text-gray-300 mt-3">
                      by <span className="font-bold text-white bg-gray-800 px-3 py-1 rounded-lg ml-2">{getTeamName(lastBidInfo.captain_id)}</span>
                    </p>
                  )}
                </div>
              )}

              {/* Bid history toggle */}
              {currentPlayerBidHistory.length > 0 && (
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
                      {currentPlayerBidHistory.map((b) => (
                        <div key={b.id} className="flex justify-between items-center py-1 border-b border-gray-800 last:border-0">
                          <span className="text-gray-300 truncate max-w-[55%]">{getTeamName(b.captain_id)}</span>
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
            <div className="text-center max-w-lg w-full mx-auto text-center">
              {store.status === "completed" ? (
                <div className="w-full max-w-4xl text-left">
                  <div className="text-center mb-6">
                    <div className="text-7xl mb-4">🏆</div>
                    <h2 className="text-4xl font-bold text-white">Auction Completed</h2>
                    <p className="text-gray-400 mt-2">Final event summary</p>
                  </div>
                  {completedSummary ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
                          <p className="text-xs text-gray-500 uppercase">Total</p>
                          <p className="text-2xl font-bold text-white">{completedSummary.stats.total_players}</p>
                        </div>
                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
                          <p className="text-xs text-gray-500 uppercase">Sold</p>
                          <p className="text-2xl font-bold text-green-400">{completedSummary.stats.sold_count}</p>
                        </div>
                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
                          <p className="text-xs text-gray-500 uppercase">Unsold</p>
                          <p className="text-2xl font-bold text-red-400">{completedSummary.stats.unsold_count}</p>
                        </div>
                      </div>

                      {completedSummary.highest_bid_player && (
                        <div className="bg-gray-900 border border-amber-500/30 rounded-xl p-4">
                          <p className="text-xs text-gray-500 uppercase mb-1">Highest Bid Player</p>
                          <p className="text-lg font-bold text-white">{completedSummary.highest_bid_player.player_name}</p>
                          <p className="text-sm text-amber-300">
                            ₹{completedSummary.highest_bid_player.sold_price} · {completedSummary.highest_bid_player.team_name}
                          </p>
                        </div>
                      )}

                      {completedSummary.strongest_team && (
                        <div className="bg-gray-900 border border-blue-500/30 rounded-xl p-4">
                          <p className="text-xs text-gray-500 uppercase mb-1">Most Powerful Team (Ratings)</p>
                          <p className="text-lg font-bold text-white">{completedSummary.strongest_team.team_name}</p>
                          <p className="text-sm text-blue-300">
                            Overall Avg: {completedSummary.strongest_team.overall_rating}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            Bat {completedSummary.strongest_team.batting_avg} · Bowl {completedSummary.strongest_team.bowling_avg} · Field {completedSummary.strongest_team.fielding_avg}
                          </p>
                        </div>
                      )}

                      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                        <p className="text-xs text-gray-500 uppercase mb-2">Teams and Players</p>
                        <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                          {completedSummary.teams.map((t) => (
                            <details key={t.team_id} className="bg-gray-800 rounded-lg p-2">
                              <summary className="cursor-pointer list-none flex items-center justify-between text-sm">
                                <span className="font-semibold text-white">{t.team_name}</span>
                                <span className="text-gray-400">{t.player_count} players · Left {t.remaining}</span>
                              </summary>
                              <div className="mt-2 space-y-1">
                                {t.players.map((p) => (
                                  <div key={`${t.team_id}-${p.player_id}`} className="flex items-center justify-between text-xs bg-gray-900 rounded px-2 py-1">
                                    <span className="text-gray-300 truncate">{p.name}</span>
                                    <span className="text-amber-400">₹{p.sold_price}</span>
                                  </div>
                                ))}
                              </div>
                            </details>
                          ))}
                        </div>
                      </div>

                      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                        <p className="text-xs text-gray-500 uppercase mb-2">Unsold Players</p>
                        <div className="space-y-1 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                          {completedSummary.unsold_players.length === 0 ? (
                            <p className="text-xs text-gray-500">No unsold players</p>
                          ) : (
                            completedSummary.unsold_players.map((p) => (
                              <div key={p.player_id} className="flex items-center justify-between text-xs bg-gray-800 rounded px-2 py-1">
                                <span className="text-gray-300 truncate">{p.name}</span>
                                <span className="text-red-300">Base ₹{p.base_price}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-gray-500 text-center">Loading summary...</p>
                  )}
                </div>
              ) : (
                <>
                  <div className="text-8xl mb-6">🏟️</div>
                  <h2 className="text-3xl font-bold text-white mb-3">
                    {store.status === "active"
                      ? "Waiting for next player..."
                      : store.status === "paused"
                      ? "Auction is paused"
                      : "Auction not started yet"}
                  </h2>
                  {eventMeta?.description && (
                    <p className="text-sm text-gray-500 mt-4 max-w-md mx-auto leading-relaxed">
                      {eventMeta.description}
                    </p>
                  )}
                </>
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
        <aside className="w-80 bg-gray-900 border-l border-gray-800 flex flex-col overflow-hidden">
          {/* Combined Team Standings & Rosters */}
          <div className="p-4 border-b border-gray-800 overflow-y-auto max-h-[40%] custom-scrollbar">
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
          </div>

          {/* Auction History (Filterable & Sortable) */}
          <div className="flex-1 flex flex-col overflow-hidden p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
                Players
              </h3>
              <span className="text-xs text-gray-600">{store.players.length} total</span>
            </div>
            
            {/* Controls */}
            <div className="flex items-center gap-2 mb-4">
              <select
                className="bg-gray-800 border border-gray-700 text-xs text-gray-300 rounded-lg px-2 py-1.5 outline-none focus:border-amber-500/50 flex-1"
                value={historyFilter}
                onChange={(e) => setHistoryFilter(e.target.value as "all" | "pending" | "sold" | "unsold")}
              >
                <option value="all">All ({store.players.length})</option>
                <option value="pending">Remaining ({pendingCount})</option>
                <option value="sold">Sold ({soldPlayers.length})</option>
                <option value="unsold">Unsold ({unsoldPlayers.length})</option>
              </select>
              <select
                className="bg-gray-800 border border-gray-700 text-xs text-gray-300 rounded-lg px-2 py-1.5 outline-none focus:border-amber-500/50 flex-1"
                value={teamFilter}
                onChange={(e) => setTeamFilter(e.target.value)}
              >
                <option value="all">All Teams</option>
                {store.teams.map((t) => (
                  <option key={t.id} value={t.name}>{t.name}</option>
                ))}
                <option value="unassigned">No Team</option>
              </select>
              <select
                className="bg-gray-800 border border-gray-700 text-xs text-gray-300 rounded-lg px-2 py-1.5 outline-none focus:border-amber-500/50 flex-1"
                value={historySort}
                onChange={(e) => setHistorySort(e.target.value as "price-desc" | "price-asc" | "name")}
              >
                <option value="price-desc">Price: High to Low</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="name">Name (A-Z)</option>
              </select>
            </div>

            {/* List */}
            <div className="space-y-2 overflow-y-auto flex-1 pr-1 custom-scrollbar">
              {allPlayersFiltered.length === 0 ? (
                <p className="text-xs text-gray-500 text-center py-4 bg-gray-800/50 rounded-xl">No players found</p>
              ) : (
                  allPlayersFiltered.map((p) => {
                    const teamName = getTeamNameForPlayer(p.player_id);

                    return (
                      <div key={p.id} className="flex items-center gap-2 bg-gray-800 rounded-xl p-2.5">
                        {playerPhotos[p.player_id] ? (
                          <div className="w-7 h-7 rounded-full overflow-hidden shrink-0">
                            <img src={playerPhotos[p.player_id] as string} alt="" className="w-full h-full object-cover" />
                          </div>
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-[11px] text-gray-400 shrink-0">
                            {(playerNames[p.player_id] || "?")[0]?.toUpperCase()}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-gray-200 font-medium truncate">
                            {playerNames[p.player_id] || `#${p.player_id}`}
                          </p>
                          {teamName && (
                            <p className="text-[10px] text-gray-500 truncate">{teamName}</p>
                          )}
                        </div>
                        {p.status === "pending" ? (
                          <span className="text-gray-500 text-[10px] font-semibold px-1.5 py-0.5 bg-gray-700 rounded shrink-0">
                            PENDING
                          </span>
                        ) : p.status === "unsold" ? (
                          <span className="text-red-400 text-[10px] font-semibold px-1.5 py-0.5 bg-red-500/10 rounded shrink-0">
                            UNSOLD
                          </span>
                        ) : (
                          <span className="text-green-400 font-semibold text-xs shrink-0">
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
