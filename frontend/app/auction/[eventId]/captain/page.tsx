"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import api from "@/lib/api";
import { useAuctionStore } from "@/store/auction";
import { useAuthStore } from "@/store/auth";
import { AuctionSocket } from "@/lib/ws";
import AuctionPlayerCard from "@/components/AuctionPlayerCard";

interface TeamDetail {
  id: number;
  name: string;
  budget: number;
  spent: number;
  max_players: number;
  players: { id: number; player_id: number; sold_price: number }[];
}

interface EventMeta {
  name: string;
  scheduled_at: string | null;
  status: string;
  logo: string | null;
}

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

const getMinBidStep = (currentBid: number) => {
  if (currentBid >= 100000) return 10000;
  if (currentBid >= 10000) return 1000;
  if (currentBid >= 1000) return 100;
  return 50;
};

export default function CaptainPage() {
  const router = useRouter();
  const { eventId } = useParams<{ eventId: string }>();
  const eid = parseInt(eventId);
  const store = useAuctionStore();
  const user = useAuthStore((s) => s.user);
  const [hasAccess, setHasAccess] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [myTeam, setMyTeam] = useState<TeamDetail | null>(null);
  const [playerNames, setPlayerNames] = useState<Record<number, string>>({});
  const [playerPhotos, setPlayerPhotos] = useState<Record<number, string>>({});
  const [isLoadingPlayers, setIsLoadingPlayers] = useState(true);
  const [bidAmount, setBidAmount] = useState("");
  const [bidError, setBidError] = useState("");
  const [bidding, setBidding] = useState(false);
  const [eventMeta, setEventMeta] = useState<EventMeta | null>(null);
  const [completedSummary, setCompletedSummary] = useState<CompletedSummary | null>(null);
  const [teamRosters, setTeamRosters] = useState<Record<number, { player_id: number; sold_price: number }[]>>({});
  const [bookmarked, setBookmarked] = useState<number[]>([]);
  const [playerFilter, setPlayerFilter] = useState<"all" | "pending" | "unsold">("pending");
  const [socket, setSocket] = useState<AuctionSocket | null>(null);
  const [viewerCount, setViewerCount] = useState<number>(0);

  const BOOKMARK_KEY = `captain_bookmarks_${eid}`;

  // Load bookmarks from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(BOOKMARK_KEY);
      if (stored) setBookmarked(JSON.parse(stored));
    } catch {}
  }, [BOOKMARK_KEY]);

  const toggleBookmark = (id: number) => {
    setBookmarked((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try { localStorage.setItem(BOOKMARK_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  useEffect(() => {
    const checkAccess = async () => {
      try {
        const token = localStorage.getItem("token");
        if (!token) {
          router.replace("/auth/login");
          return;
        }

        const meRes = await api.get("/auth/me");
        const me = meRes.data as { roles: string[] };
        const isCaptainRole = (me.roles || []).includes("captain");
        if (!isCaptainRole) {
          router.replace(`/auction/${eid}/spectate`);
          return;
        }

        // Must be assigned as captain in this event.
        await api.get(`/auction/events/${eid}/my-team`);
        setHasAccess(true);
      } catch {
        router.replace(`/auction/${eid}/spectate`);
      } finally {
        setCheckingAccess(false);
      }
    };

    checkAccess();
  }, [eid, router]);

  const syncState = useCallback(async () => {
    const [stateRes, teamRes, eventRes, teamsRes, viewerStatsRes] = await Promise.all([
      api.get(`/auction/events/${eid}/state`),
      api.get(`/auction/events/${eid}/my-team`).catch(() => ({ data: null })),
      api.get(`/auction/events/${eid}`).catch(() => ({ data: null })),
      api.get(`/auction/events/${eid}/teams`).catch(() => ({ data: [] })),
      api.get(`/auction/events/${eid}/viewer-stats`).catch(() => ({ data: null })),
    ]);
    store.setFullState({
      eventId: eid,
      status: stateRes.data.status,
      timer: stateRes.data.timer || 0,
      activePlayerId: stateRes.data.active_player_id,
      teams: stateRes.data.teams || [],
      players: stateRes.data.players || [],
    });
    setMyTeam(teamRes.data);
    if (eventRes.data) {
      setEventMeta({
        name: eventRes.data.name,
        scheduled_at: eventRes.data.scheduled_at ?? null,
        status: eventRes.data.status,
        logo: eventRes.data.logo ?? null,
      });
    }
    if (teamsRes.data) {
      const map: Record<number, { player_id: number; sold_price: number }[]> = {};
      teamsRes.data.forEach((t: { id: number; players: { player_id: number; sold_price: number }[] }) => {
        map[t.id] = t.players || [];
      });
      setTeamRosters(map);
    }
    // Set initial viewer count from API (especially important for completed events)
    if (viewerStatsRes.data) {
      const count = stateRes.data.status === "completed" 
        ? viewerStatsRes.data.total_unique_viewers 
        : viewerStatsRes.data.live_viewers;
      setViewerCount(count || 0);
    }
  }, [eid]);

  useEffect(() => {
    if (!hasAccess) return;
    syncState();

    // Fetch player names regardless of event status
    api.get(`/auction/events/${eid}/players-info`).then(({ data }) => {
      const nameMap: Record<number, string> = {};
      const photoMap: Record<number, string> = {};
      data.forEach((row: { player_id: number; name: string; profile_photo?: string }) => {
        nameMap[row.player_id] = row.name;
        if (row.profile_photo) photoMap[row.player_id] = row.profile_photo;
      });
      setPlayerNames(nameMap);
      setPlayerPhotos(photoMap);
      setIsLoadingPlayers(false);
    }).catch(() => {
      setIsLoadingPlayers(false);
    });
  }, [eid, hasAccess, syncState]);

  // Only connect WebSocket for non-completed events
  useEffect(() => {
    if (!hasAccess) return;
    // Don't connect WebSocket for completed events
    if (store.status === "completed") return;

    const token = localStorage.getItem("token") || "";
    const ws = new AuctionSocket(eid, token);
    ws.connect();

    ws.on("*", (msg) => {
      if (msg.type === "timer_tick") store.setTimer(msg.remaining as number);
      if (msg.type === "new_bid") {
        store.updateBid(msg.auction_player_id as number, msg.amount as number, msg.captain_id as number);
        setBidAmount((prev) => {
          const currentBid = msg.amount as number;
          const nextStep = getMinBidStep(currentBid);
          const next = (parseInt(prev) || currentBid);
          return next <= currentBid ? (currentBid + nextStep).toString() : prev;
        });
      }
      if (msg.type === "player_sold") {
        store.markPlayerSold(msg.auction_player_id as number, msg.sold_to_captain_id as number, msg.sold_price as number);
        syncState();
      }
      if (msg.type === "player_unsold") {
        store.markPlayerUnsold(msg.auction_player_id as number);
      }
      if (msg.type === "player_up") {
        store.setActivePlayer(msg.auction_player_id as number, msg.base_price as number);
        const basePrice = msg.base_price as number;
        setBidAmount((basePrice + getMinBidStep(basePrice)).toString());
        setBidError("");
      }
      if (msg.type === "auction_resumed") store.setFullState({ status: "active" });
      if (msg.type === "auction_paused") store.setFullState({ status: "paused" });
      if (msg.type === "auction_completed") store.setFullState({ status: "completed" });
      if (msg.type === "viewer_count") setViewerCount(msg.count as number);
    });

    setSocket(ws);
    return () => ws.disconnect();
  }, [eid, hasAccess, store.status, syncState]);

  useEffect(() => {
    if (!hasAccess || store.status !== "completed") {
      setCompletedSummary(null);
      return;
    }
    api.get(`/auction/events/${eid}/summary`)
      .then(({ data }) => setCompletedSummary(data as CompletedSummary))
      .catch(() => setCompletedSummary(null));
  }, [eid, hasAccess, store.status]);

  const activeAP = store.players.find((p) => p.id === store.activePlayerId);
  const remaining = myTeam ? myTeam.budget - myTeam.spent : 0;
  const captainIds = new Set(
    store.teams
      .map((t) => t.captain_id)
      .filter((id): id is number => id !== null)
  );
  const pendingPlayers = store.players.filter(
    (p) => p.status === "pending" && p.player_id !== user?.id && !captainIds.has(p.player_id)
  );
  const unsoldPlayers = store.players.filter(
    (p) => p.status === "unsold" && p.player_id !== user?.id && !captainIds.has(p.player_id)
  );

  // All non-self players (pending + unsold), bookmarked floated to top
  const filteredPlayers = (() => {
    let base: typeof store.players = [];
    if (playerFilter === "all") {
      base = store.players.filter(
        (p) =>
          p.player_id !== user?.id &&
          (p.status === "pending" || p.status === "unsold") &&
          !captainIds.has(p.player_id)
      );
    }
    else if (playerFilter === "pending") base = pendingPlayers;
    else base = unsoldPlayers;
    // bookmarked first
    const starred = base.filter(p => bookmarked.includes(p.id));
    const rest = base.filter(p => !bookmarked.includes(p.id));
    return [...starred, ...rest];
  })();

  const placeBid = async () => {
    if (!bidAmount) return;
    const numericAmount = parseInt(bidAmount, 10);
    const validationError = getBidValidationError(numericAmount);
    if (validationError) {
      setBidError(validationError);
      return;
    }
    setBidding(true);
    setBidError("");
    try {
      await api.post(`/auction/events/${eid}/bid`, { amount: numericAmount });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setBidError(msg || "Bid failed");
    } finally {
      setBidding(false);
    }
  };

  const isMyBid = activeAP?.current_bidder_id === user?.id;
  const effectiveBid = activeAP ? (activeAP.current_bid || activeAP.base_price) : 0;
  const maxAllowedBid = effectiveBid + Math.floor(effectiveBid / 2);
  const minBidStep = getMinBidStep(effectiveBid);
  const isResultState = activeAP?.status === "sold" || activeAP?.status === "unsold";
  const iWonPlayer = !!activeAP && activeAP.status === "sold" && activeAP.current_bidder_id === user?.id;

  const quickIncrements = (() => {
    if (effectiveBid >= 100000) return [10000, 20000, 50000];
    if (effectiveBid >= 10000) return [1000, 2000, 5000];
    if (effectiveBid >= 1000) return [100, 200, 500];
    return [50, 100, 200];
  })();

  const getTeamName = (captainId: number) => {
    const team = store.teams.find((t) => t.captain_id === captainId);
    return team ? team.name : playerNames[captainId] || `Captain #${captainId}`;
  };

  const getBidValidationError = (amount: number) => {
    if (Number.isNaN(amount)) return "Enter a valid bid amount";
    const increment = amount - effectiveBid;
    if (increment < minBidStep) return `Minimum increment for current bid is ${minBidStep}`;
    if (increment % minBidStep !== 0) return `Bid increment must be in multiples of ${minBidStep}`;
    if (amount > maxAllowedBid) {
      return `Bid cannot exceed 50% of current bid. Max allowed: ${maxAllowedBid}`;
    }
    return "";
  };
  const parsedBidAmount = parseInt(bidAmount, 10);
  const inlineBidError = bidAmount ? getBidValidationError(parsedBidAmount) : "";
  const bidDisabled = isMyBid || bidding || !activeAP || !!inlineBidError;

  if (checkingAccess) {
    return (
      <div className="h-screen bg-gray-950 flex items-center justify-center text-gray-400">
        Checking access...
      </div>
    );
  }
  if (!hasAccess) return null;

  return (
    <div className="h-screen bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/dashboard")}
            className="text-gray-500 hover:text-white flex items-center justify-center w-8 h-8 rounded-full hover:bg-gray-800 transition-colors"
            title="Exit to Dashboard"
          >
            ←
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold">{myTeam ? myTeam.name : "Captain View"}</h1>
              {store.status === "completed" && (
                <span className="bg-green-500/20 text-green-400 text-xs font-semibold px-2 py-1 rounded">COMPLETED</span>
              )}
            </div>
            {eventMeta?.scheduled_at && store.status !== "completed" && (
              <p className="text-xs text-gray-500 mt-0.5">
                Auction:{" "}
                {new Date(eventMeta.scheduled_at).toLocaleString("en-IN", {
                  weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                })}
              </p>
            )}
          </div>
        </div>
        {myTeam && (
          <div className="flex gap-6 text-center">
            <div>
              <p className="text-xl font-bold text-blue-400">{viewerCount}</p>
              <p className="text-xs text-gray-500">{store.status === "completed" ? "Watched" : "Watching"}</p>
            </div>
            <div>
              <p className="text-xl font-bold text-amber-400">{remaining}</p>
              <p className="text-xs text-gray-500">Budget Left</p>
            </div>
            <div>
              <p className="text-xl font-bold">{myTeam.players.length}/{myTeam.max_players}</p>
              <p className="text-xs text-gray-500">Players</p>
            </div>
            <div className="text-right">
              <p className={`text-xs font-semibold uppercase ${store.status === "active" ? "text-green-400" : "text-gray-500"}`}>
                {store.status === "active" ? "Live" : store.status}
              </p>
              <div className={`w-2 h-2 rounded-full ml-auto mt-1 ${store.status === "active" ? "bg-green-400 animate-pulse" : "bg-red-500"}`} />
            </div>
          </div>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Main area */}
        <div className="flex-1 p-6 overflow-scroll">
          {activeAP ? (
            <div className="max-w-2xl space-y-4">
              <AuctionPlayerCard
                playerName={playerNames[activeAP.player_id] || `Player #${activeAP.player_id}`}
                playerPhoto={playerPhotos[activeAP.player_id]}
                basePrice={activeAP.base_price}
                currentBid={activeAP.current_bid}
                currentBidderName={activeAP.current_bidder_id ? getTeamName(activeAP.current_bidder_id) : undefined}
                timer={store.timer}
                status={activeAP.status}
              />
              {isMyBid && activeAP.status === "active" && (
                <div className="bg-green-500/20 border border-green-500/30 rounded-xl p-4 text-center">
                  <p className="text-green-400 font-semibold">You have the highest bid!</p>
                </div>
              )}
              {!isResultState ? (
                <div className="card">
                  <label className="label">Your Bid Amount</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      className="input"
                      value={bidAmount}
                      onChange={(e) => {
                        setBidAmount(e.target.value);
                        if (bidError) setBidError("");
                      }}
                      placeholder="Enter amount"
                      min={effectiveBid + minBidStep}
                      max={maxAllowedBid}
                      step={minBidStep}
                      disabled={isMyBid || bidding || !activeAP}
                    />
                    <button className="btn-primary whitespace-nowrap" onClick={placeBid} disabled={bidDisabled}>
                      {bidding ? "..." : "Bid"}
                    </button>
                  </div>
                  {(bidError || inlineBidError) && (
                    <p className="text-red-400 text-sm mt-2">{bidError || inlineBidError}</p>
                  )}
                  <div className="flex gap-2 mt-3">
                    {quickIncrements.map((inc) => (
                      <button
                        key={inc}
                        className="btn-secondary text-xs px-2 py-1"
                        onClick={() => setBidAmount((effectiveBid + inc).toString())}
                        disabled={isMyBid || bidding || !activeAP || (effectiveBid + inc) > maxAllowedBid}
                      >
                        +{inc}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className={`relative overflow-hidden rounded-xl border p-5 text-center ${
                  activeAP.status === "sold"
                    ? "bg-green-500/10 border-green-500/40"
                    : "bg-red-500/10 border-red-500/40"
                }`}>
                  {activeAP.status === "sold" && (
                    <div className="absolute inset-0 pointer-events-none">
                      <div className="absolute -top-2 left-4 text-2xl animate-bounce">🎉</div>
                      <div className="absolute -top-2 right-6 text-2xl animate-bounce [animation-delay:120ms]">✨</div>
                    </div>
                  )}
                  {activeAP.status === "unsold" && (
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                      <div className="text-red-400/20 text-[110px] font-black leading-none select-none animate-pulse">✕</div>
                    </div>
                  )}
                  <p className={`text-lg font-bold ${iWonPlayer ? "text-green-300" : "text-amber-300"}`}>
                    {iWonPlayer ? "You got the player!" : activeAP.status === "sold" ? "Player Sold" : "Player Unsold"}
                  </p>
                  <p className="text-sm text-gray-300 mt-1">
                    {activeAP.status === "sold"
                      ? `Sold to ${getTeamName(activeAP.current_bidder_id as number)} for ₹${activeAP.current_bid}`
                      : `${playerNames[activeAP.player_id] || `Player #${activeAP.player_id}`} remains UNSOLD.`}
                  </p>
                  <p className="text-xs text-gray-500 mt-2">Waiting for auctioneer to move next player...</p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center max-w-lg mx-auto text-center">
              {store.status === "completed" ? (
                <div className="w-full max-w-3xl text-left">
                  <div className="text-center mb-6">
                    {eventMeta?.logo ? (
                      <div className="w-24 h-24 mx-auto mb-4 rounded-2xl overflow-hidden bg-gray-800 border border-gray-700 shadow-lg">
                        <img src={eventMeta.logo} alt="" className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="text-7xl mb-4">🏆</div>
                    )}
                    <h2 className="text-4xl font-bold text-white">Auction Completed</h2>
                    <p className="text-gray-400 mt-2">Final summary for captains</p>
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
                        <p className="text-xs text-gray-500 uppercase mb-2">Unsold Players</p>
                        <div className="space-y-1 max-h-36 overflow-y-auto custom-scrollbar pr-1">
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
                </>
              )}
              {store.status !== "completed" && store.status !== "active" && eventMeta?.scheduled_at && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mt-8 w-full">
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

        {/* Side panel */}
        <aside className="w-80 bg-gray-900 border-l border-gray-800 flex flex-col overflow-hidden">
          {/* My Team Roster */}
          <div className="p-4 border-b border-gray-800">
            <h3 className="text-sm font-semibold text-gray-400 uppercase mb-3">
              My Team Roster {myTeam && <span className="text-gray-600">({myTeam.players.length}/{myTeam.max_players})</span>}
            </h3>
            {myTeam && myTeam.players.length > 0 ? (
              <div className="space-y-1.5">
                {myTeam.players.map((tp) => (
                  <div key={tp.id} className="flex items-center gap-2 bg-gray-800 rounded-xl px-2.5 py-2">
                    {playerPhotos[tp.player_id] ? (
                      <div className="w-7 h-7 rounded-full overflow-hidden shrink-0">
                        <img src={playerPhotos[tp.player_id]} alt="" className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-[11px] text-gray-400 shrink-0">
                        {(playerNames[tp.player_id] || "?")[0]?.toUpperCase()}
                      </div>
                    )}
                    <span className="text-sm flex-1 truncate">{playerNames[tp.player_id] || `Player #${tp.player_id}`}</span>
                    <span className="text-green-400 text-xs font-semibold shrink-0">₹{tp.sold_price}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-600 text-center py-3">No players yet. Start bidding!</p>
            )}
          </div>

          {/* Other Teams (expandable) */}
          <div className="p-4 border-b border-gray-800">
            <h3 className="text-sm font-semibold text-gray-400 uppercase mb-3">Other Teams</h3>
            <div className="space-y-2 max-h-44 overflow-y-auto pr-1 custom-scrollbar">
              {store.teams
                .filter((t) => t.captain_id !== user?.id)
                .map((t) => {
                  const roster = teamRosters[t.id] || [];
                  const left = t.budget - t.spent;
                  return (
                    <details key={t.id} className="bg-gray-800 rounded-lg overflow-hidden group">
                      <summary className="list-none cursor-pointer px-3 py-2">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium truncate">{t.name}</p>
                          <span className="text-[10px] text-gray-500">{t.player_count}/{t.max_players}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between text-[10px]">
                          <span className="text-gray-500">Spent: {t.spent}</span>
                          <span className={left < 200 ? "text-red-400" : "text-green-400"}>Left: {left}</span>
                        </div>
                      </summary>
                      <div className="px-2 pb-2">
                        {roster.length > 0 ? (
                          <div className="space-y-1">
                            {roster.map((rp, idx) => (
                              <div key={`${t.id}-${rp.player_id}-${idx}`} className="flex items-center justify-between bg-gray-900 rounded px-2 py-1">
                                <span className="text-[11px] text-gray-300 truncate">
                                  {playerNames[rp.player_id] || `Player #${rp.player_id}`}
                                </span>
                                <span className="text-[11px] text-amber-400">₹{rp.sold_price}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[11px] text-gray-600 italic px-1 pb-1">No players yet</p>
                        )}
                      </div>
                    </details>
                  );
                })}
            </div>
          </div>

          {/* Players list */}
          <div className="flex-1 flex flex-col overflow-hidden p-4">
            {/* Filter tabs */}
            <div className="flex gap-1 mb-3 bg-gray-800 rounded-lg p-1">
              {([
                ["pending", `Remaining (${pendingPlayers.length})`],
                ["unsold", `Unsold (${unsoldPlayers.length})`],
                ["all", `All (${pendingPlayers.length + unsoldPlayers.length})`],
              ] as [typeof playerFilter, string][]).map(([val, label]) => (
                <button
                  key={val}
                  className={`flex-1 text-[10px] font-semibold py-1.5 rounded-md transition-colors ${
                    playerFilter === val ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"
                  }`}
                  onClick={() => setPlayerFilter(val)}
                >
                  {label}
                </button>
              ))}
            </div>

            {bookmarked.length > 0 && filteredPlayers.some(p => bookmarked.includes(p.id)) && (
              <p className="text-[10px] text-amber-500/70 uppercase font-semibold mb-1.5 px-1">★ Bookmarked first</p>
            )}

            <div className="space-y-1.5 overflow-y-auto flex-1 pr-1 custom-scrollbar">
              {isLoadingPlayers ? (
                <div className="flex flex-col items-center justify-center py-10 space-y-3">
                  <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-xs text-gray-500">Loading players...</p>
                </div>
              ) : filteredPlayers.length === 0 ? (
                <p className="text-xs text-gray-600 text-center py-6">No players in this category.</p>
              ) : (
                filteredPlayers.map((p) => {
                  const isBookmarked = bookmarked.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-left transition-colors ${
                        isBookmarked
                          ? "bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/15"
                          : "bg-gray-800 border border-transparent hover:bg-gray-750"
                      }`}
                      onClick={() => toggleBookmark(p.id)}
                    >
                      {playerPhotos[p.player_id] ? (
                        <div className="w-7 h-7 rounded-full overflow-hidden shrink-0">
                          <img
                            src={playerPhotos[p.player_id]}
                            alt=""
                            className={`w-full h-full object-cover ${p.status === "unsold" ? "grayscale opacity-60" : ""}`}
                          />
                        </div>
                      ) : (
                        <div className={`w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-[11px] shrink-0 ${p.status === "unsold" ? "text-gray-600 opacity-60" : "text-gray-400"}`}>
                          {(playerNames[p.player_id] || "?")[0]?.toUpperCase()}
                        </div>
                      )}
                      <span className={`text-xs flex-1 truncate ${p.status === "unsold" ? "text-gray-500" : "text-gray-200"}`}>
                        {playerNames[p.player_id] || `Player #${p.player_id}`}
                      </span>
                      <span className="flex items-center gap-1 shrink-0">
                        {p.status === "unsold" && (
                          <span className="text-red-400 text-[9px] font-semibold px-1.5 py-0.5 bg-red-500/10 rounded">UNSOLD</span>
                        )}
                        <span className={`text-sm ${isBookmarked ? "text-amber-400" : "text-gray-600 hover:text-gray-400"}`}>★</span>
                      </span>
                    </button>
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

