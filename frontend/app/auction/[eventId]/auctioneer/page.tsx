"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import api from "@/lib/api";
import { useAuctionStore, PlayerState } from "@/store/auction";
import { AuctionSocket } from "@/lib/ws";
import AuctionPlayerCard from "@/components/AuctionPlayerCard";
import TeamSummary from "@/components/TeamSummary";

export default function AuctioneerPage() {
  const router = useRouter();
  const { eventId } = useParams<{ eventId: string }>();
  const eid = parseInt(eventId);
  const store = useAuctionStore();
  const [hasAccess, setHasAccess] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [socket, setSocket] = useState<AuctionSocket | null>(null);
  const [status, setStatus] = useState("draft");
  const [scheduledAt, setScheduledAt] = useState<string | null>(null);
  const [playerNames, setPlayerNames] = useState<Record<number, string>>({});
  const [playerPhotos, setPlayerPhotos] = useState<Record<number, string>>({});
  const [teamRosters, setTeamRosters] = useState<Record<number, { player_id: number; sold_price: number }[]>>({});
  const [viewerCount, setViewerCount] = useState<number>(0);

  const syncState = useCallback(async () => {
    const [{ data }, teamRes, viewerStatsRes] = await Promise.all([
      api.get(`/auction/events/${eid}/state`),
      api.get(`/auction/events/${eid}/teams`).catch(() => ({ data: [] })),
      api.get(`/auction/events/${eid}/viewer-stats`).catch(() => ({ data: null })),
    ]);
    store.setFullState({
      eventId: eid,
      status: data.status,
      timer: data.timer || 0,
      activePlayerId: data.active_player_id,
      teams: data.teams || [],
      players: data.players || [],
    });
    setStatus(data.status);
    setScheduledAt(data.scheduled_at || null);
    if (teamRes.data) {
      const map: Record<number, { player_id: number; sold_price: number }[]> = {};
      teamRes.data.forEach((t: { id: number; players: { player_id: number; sold_price: number }[] }) => {
        map[t.id] = t.players || [];
      });
      setTeamRosters(map);
    }
    // Set initial viewer count from API (especially important for completed events)
    if (viewerStatsRes.data) {
      const count = data.status === "completed" 
        ? viewerStatsRes.data.total_unique_viewers 
        : viewerStatsRes.data.live_viewers;
      setViewerCount(count || 0);
    }
  }, [eid]);

  useEffect(() => {
    const checkAccess = async () => {
      try {
        const token = localStorage.getItem("token");
        if (!token) {
          router.replace("/auth/login");
          return;
        }

        const [meRes, eventRes] = await Promise.all([
          api.get("/auth/me"),
          api.get(`/auction/events/${eid}`),
        ]);
        const me = meRes.data as { id: number; roles: string[] };
        const event = eventRes.data as { auctioneer_id: number | null };

        const isAuctioneerRole = (me.roles || []).includes("auctioneer");
        const isAssignedAuctioneer = event.auctioneer_id === me.id;

        if (!isAuctioneerRole || !isAssignedAuctioneer) {
          router.replace(`/auction/${eid}/spectate`);
          return;
        }

        setHasAccess(true);
      } catch {
        router.replace("/dashboard");
      } finally {
        setCheckingAccess(false);
      }
    };

    checkAccess();
  }, [eid, router]);

  useEffect(() => {
    if (!hasAccess) return;
    syncState();
  }, [eid, hasAccess, syncState]);

  // Only connect WebSocket for non-completed events
  useEffect(() => {
    if (!hasAccess) return;
    // Don't connect WebSocket for completed events
    if (status === "completed") return;

    const token = localStorage.getItem("token") || "";
    const ws = new AuctionSocket(eid, token);
    ws.connect();

    ws.on("*", (msg) => {
      if (msg.type === "timer_tick") store.setTimer(msg.remaining as number);
      if (msg.type === "new_bid")
        store.updateBid(msg.auction_player_id as number, msg.amount as number, msg.captain_id as number);
      if (msg.type === "player_sold")
        store.markPlayerSold(msg.auction_player_id as number, msg.sold_to_captain_id as number, msg.sold_price as number);
      if (msg.type === "player_unsold")
        store.markPlayerUnsold(msg.auction_player_id as number);
      if (msg.type === "player_up")
        store.setActivePlayer(msg.auction_player_id as number, msg.base_price as number);
      if (msg.type === "auction_paused") setStatus("paused");
      if (msg.type === "auction_resumed") setStatus("active");
      if (msg.type === "auction_completed") setStatus("completed");
      if (msg.type === "viewer_count") setViewerCount(msg.count as number);
    });

    setSocket(ws);
    return () => ws.disconnect();
  }, [eid, hasAccess, status]);

  // Fetch player names for display (only players in this event)
  useEffect(() => {
    const fetchNames = async () => {
      const { data } = await api.get(`/auction/events/${eid}/players-info`).catch(() => ({ data: [] }));
      const nameMap: Record<number, string> = {};
      const photoMap: Record<number, string> = {};
      data.forEach((row: { player_id: number; name: string; profile_photo?: string }) => { 
        nameMap[row.player_id] = row.name; 
        if (row.profile_photo) {
          photoMap[row.player_id] = row.profile_photo;
        }
      });
      setPlayerNames(nameMap);
      setPlayerPhotos(photoMap);
    };
    fetchNames();
  }, [eid]);

  const activeAP = store.players.find((p) => p.id === store.activePlayerId);
  const displayActiveAP = activeAP?.status === "active" ? activeAP : null;
  const isTimerRunning = status === "active" && !!displayActiveAP && store.timer > 0;
  const captainIds = new Set(
    store.teams
      .map((t) => t.captain_id)
      .filter((id): id is number => id !== null)
  );
  const pendingPlayers = store.players.filter(
    (p) => p.status === "pending" && !captainIds.has(p.player_id)
  );
  const soldPlayers = store.players.filter((p) => p.status === "sold");
  const unsoldPlayers = store.players.filter((p) => p.status === "unsold");

  const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
  const canStart =
    status !== "active" &&
    (!scheduledDate || scheduledDate <= new Date());

  const startAuction = () => api.post(`/auction/events/${eid}/start`).then(syncState);
  const pauseAuction = () => api.post(`/auction/events/${eid}/pause`).then(syncState);
  
  const finishAuction = async () => {
    if (pendingPlayers.length > 0) {
      alert("Cannot finish auction while players are still pending.");
      return;
    }
    if (confirm("Are you sure you want to finish the auction? This will mark the event as completed and no further changes can be made.")) {
      try {
        await api.post(`/auction/events/${eid}/finish`);
        await syncState();
      } catch (e: any) {
        alert(e.response?.data?.detail || "Error finishing auction");
      }
    }
  };

  const nextPlayer = (playerId?: number) =>
    api.post(`/auction/events/${eid}/next-player`, { player_id: playerId || null }).catch((e) =>
      alert(e.response?.data?.detail || "Error")
    );
  const hammer = async () => {
    if (!displayActiveAP) return;
    const isMidTimer = store.timer > 0 && store.timer < 60;
    if (isMidTimer) {
      const ok = confirm("Timer is still running. Hammer now?");
      if (!ok) {
        // Native confirm blocks the UI thread; force-refresh to avoid stale timer UI.
        await syncState();
        return;
      }
    }
    try {
      await api.post(`/auction/events/${eid}/hammer`);
      await syncState();
    } catch (e: any) {
      alert(e.response?.data?.detail || "Error");
      await syncState();
    }
  };

  const getTeamName = (captainId: number) => {
    const team = store.teams.find((t) => t.captain_id === captainId);
    return team ? team.name : playerNames[captainId] || `Captain #${captainId}`;
  };

  if (checkingAccess) {
    return (
      <div className="min-h-screen p-6 bg-gray-950 flex items-center justify-center text-gray-400">
        Checking access...
      </div>
    );
  }

  if (!hasAccess) return null;

  return (
    <div className="min-h-screen p-6 bg-gray-950">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-start mb-6">
          <div>
            <button
              onClick={() => router.push("/dashboard")}
              className="text-gray-500 hover:text-white flex items-center gap-2 text-sm mb-3 transition-colors"
            >
              <span>←</span> Exit to Dashboard
            </button>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">Auctioneer Panel</h1>
              <div className="flex items-center gap-1.5 bg-blue-500/20 text-blue-400 text-xs font-semibold px-2.5 py-1 rounded">
                <span>👁</span> {viewerCount} {status === "completed" ? "watched" : "watching"}
              </div>
              {status === "completed" && (
                <span className="bg-green-500/20 text-green-400 text-xs font-semibold px-2 py-1 rounded">
                  COMPLETED
                </span>
              )}
            </div>
            {scheduledDate && status !== "completed" && (
              <p className="text-xs text-gray-500 mt-1">
                Scheduled for{" "}
                {scheduledDate.toLocaleString("en-IN", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            )}
          </div>
          
          {status !== "completed" && (
            <div className="flex items-center gap-2">
              {status !== "active" && (
                <div className="flex flex-col items-end gap-1">
                  <div className="flex items-center gap-2">
                    <button
                      className={`btn-primary ${!canStart ? "opacity-50 cursor-not-allowed" : ""}`}
                      onClick={startAuction}
                      disabled={!canStart}
                    >
                      {status === "paused" ? "▶ Resume Auction" : "▶ Start Auction"}
                    </button>
                    {status === "paused" && (
                       <button
                         className={`btn-secondary border-red-500/30 text-red-400 hover:bg-red-500/10 ${pendingPlayers.length > 0 ? "opacity-50 cursor-not-allowed" : ""}`}
                         onClick={finishAuction}
                         disabled={pendingPlayers.length > 0}
                         title={pendingPlayers.length > 0 ? "Must auction all players before finishing" : ""}
                       >
                         🏁 Finish Auction
                       </button>
                    )}
                  </div>
                  {!canStart && scheduledDate && (
                    <p className="text-[11px] text-gray-500">
                      Start button unlocks at the scheduled time.
                    </p>
                  )}
                </div>
              )}
              
              {status === "active" && (
                <>
                  <button className="btn-danger" onClick={pauseAuction}>
                    ⏸ Adjourn (Pause)
                  </button>
                  <button className="btn-secondary" onClick={() => nextPlayer()}>
                    ⏭ Random Next
                  </button>
                  {displayActiveAP && (
                    <button className="btn-primary" onClick={hammer}>
                      🔨 Hammer
                    </button>
                  )}
                  {pendingPlayers.length === 0 && !displayActiveAP && (
                    <button className="btn-secondary border-red-500/30 text-red-400 hover:bg-red-500/10" onClick={finishAuction}>
                      🏁 Finish Auction
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main auction area */}
          <div className="lg:col-span-2 space-y-6">
            {displayActiveAP ? (
              <AuctionPlayerCard
              playerName={playerNames[displayActiveAP.player_id] || `Player #${displayActiveAP.player_id}`}
              playerPhoto={playerPhotos[displayActiveAP.player_id]}
              basePrice={displayActiveAP.base_price}
                currentBid={displayActiveAP.current_bid}
                currentBidderName={
                  displayActiveAP.current_bidder_id
                    ? getTeamName(displayActiveAP.current_bidder_id)
                    : undefined
                }
                timer={store.timer}
                status={displayActiveAP.status}
              />
            ) : (
              <div className="card text-center py-16 text-gray-500">
                {status === "active" ? (
                  <p>Click &ldquo;Random Next&rdquo; or select a player below to start bidding.</p>
                ) : (
                  <p>Auction not started yet.</p>
                )}
              </div>
            )}

            {/* Team summary */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Teams</h3>
              <TeamSummary teams={store.teams} teamRosters={teamRosters} playerNames={playerNames} />
            </div>
          </div>

          {/* Player queue */}
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-400 uppercase mb-2">
                Pending ({pendingPlayers.length})
              </h3>
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1 custom-scrollbar my-3 shadow-md shadow-black/40 rounded-lg">
                {pendingPlayers.length === 0 ? (
                  <div className="rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-3 text-xs text-gray-500 text-center">
                    No pending players
                  </div>
                ) : (
                  pendingPlayers.map((p) => (
                    <div
                      key={p.id}
                      className="rounded-lg border border-amber-500/20 bg-gradient-to-r from-gray-900 to-gray-900/70 px-3 py-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          {playerPhotos[p.player_id] ? (
                            <div className="w-6 h-6 rounded-full overflow-hidden shrink-0 ring-1 ring-gray-700">
                              <img src={playerPhotos[p.player_id]} alt="" className="w-full h-full object-cover" />
                            </div>
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-gray-800 flex items-center justify-center text-[10px] text-gray-500 shrink-0 ring-1 ring-gray-700">
                              {(playerNames[p.player_id] || "?")[0]?.toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="text-sm text-gray-100 truncate">{playerNames[p.player_id] || `#${p.player_id}`}</p>
                            <p className="text-[11px] text-gray-500">Base ₹{p.base_price}</p>
                          </div>
                        </div>
                        <span className="badge-pending shrink-0">Pending</span>
                      </div>
                      {status !== "completed" && (
                        <div className="mt-2 flex justify-end">
                          <button
                            className="text-xs btn-secondary py-1 px-2 shrink-0"
                            onClick={() => nextPlayer(p.id)}
                            disabled={status !== "active"}
                          >
                            Pick
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-400 uppercase mb-2">
                Sold ({soldPlayers.length})
              </h3>
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1 custom-scrollbar my-3 shadow-md shadow-black/40 rounded-lg">
                {soldPlayers.length === 0 ? (
                  <div className="rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-3 text-xs text-gray-500 text-center">
                    No sold players yet
                  </div>
                ) : (
                  soldPlayers.map((p) => {
                    const soldToTeam = p.current_bidder_id ? getTeamName(p.current_bidder_id) : "Unknown Team";
                    return (
                      <div
                        key={p.id}
                        className="rounded-lg border border-green-500/20 bg-gradient-to-r from-gray-900 to-gray-900/70 px-3 py-2"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            {playerPhotos[p.player_id] ? (
                              <div className="w-6 h-6 rounded-full overflow-hidden shrink-0 ring-1 ring-gray-700">
                                <img src={playerPhotos[p.player_id]} alt="" className="w-full h-full object-cover" />
                              </div>
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-gray-800 flex items-center justify-center text-[10px] text-gray-500 shrink-0 ring-1 ring-gray-700">
                                {(playerNames[p.player_id] || "?")[0]?.toUpperCase()}
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="text-sm text-gray-100 truncate">{playerNames[p.player_id] || `#${p.player_id}`}</p>
                              <p className="text-[11px] text-gray-500 truncate">Sold to {soldToTeam}</p>
                            </div>
                          </div>
                          <span className="badge-sold whitespace-nowrap shrink-0">₹{p.current_bid}</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-400 uppercase mb-2">
                Unsold ({unsoldPlayers.length})
              </h3>
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1 custom-scrollbar my-3 shadow-md shadow-black/40 rounded-lg">
                {unsoldPlayers.length === 0 ? (
                  <div className="rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-3 text-xs text-gray-500 text-center">
                    No unsold players yet
                  </div>
                ) : (
                  unsoldPlayers.map((p) => {
                    const hasAnyBid = p.current_bid > p.base_price;
                    return (
                      <div
                        key={p.id}
                        className="rounded-lg border border-red-500/20 bg-gradient-to-r from-gray-900 to-gray-900/70 px-3 py-2"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            {playerPhotos[p.player_id] ? (
                              <div className="w-6 h-6 rounded-full overflow-hidden shrink-0 ring-1 ring-gray-700">
                                <img src={playerPhotos[p.player_id]} alt="" className="w-full h-full object-cover" />
                              </div>
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-gray-800 flex items-center justify-center text-[10px] text-gray-500 shrink-0 ring-1 ring-gray-700">
                                {(playerNames[p.player_id] || "?")[0]?.toUpperCase()}
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="text-sm text-gray-100 truncate">{playerNames[p.player_id] || `#${p.player_id}`}</p>
                              <p className="text-[11px] text-gray-500">
                                {hasAnyBid ? `Last bid ₹${p.current_bid}` : `Base ₹${p.base_price} - no bids`}
                              </p>
                            </div>
                          </div>
                          <span className="badge-unsold shrink-0">Unsold</span>
                        </div>
                        {status !== "completed" && pendingPlayers.length === 0 && (
                          <div className="mt-2 flex justify-end">
                            <button
                              className={`text-xs btn-secondary py-1 px-2 ${isTimerRunning ? "opacity-50 cursor-not-allowed" : ""}`}
                              onClick={() => nextPlayer(p.id)}
                              disabled={status !== "active" || isTimerRunning}
                              title={isTimerRunning ? "Wait for current timer to finish before re-auctioning" : ""}
                            >
                              Re-auction
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
