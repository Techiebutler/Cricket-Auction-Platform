"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import api from "@/lib/api";
import { useAuctionStore, PlayerState } from "@/store/auction";
import { AuctionSocket } from "@/lib/ws";
import AuctionPlayerCard from "@/components/AuctionPlayerCard";
import TeamSummary from "@/components/TeamSummary";

export default function AuctioneerPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const eid = parseInt(eventId);
  const store = useAuctionStore();
  const [socket, setSocket] = useState<AuctionSocket | null>(null);
  const [status, setStatus] = useState("draft");
  const [scheduledAt, setScheduledAt] = useState<string | null>(null);
  const [playerNames, setPlayerNames] = useState<Record<number, string>>({});

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
    setStatus(data.status);
    setScheduledAt(data.scheduled_at || null);
  }, [eid]);

  useEffect(() => {
    syncState();

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
    });

    setSocket(ws);
    return () => ws.disconnect();
  }, [eid]);

  // Fetch player names for display
  useEffect(() => {
    const fetchNames = async () => {
      const { data: users } = await api.get("/admin/users").catch(() => ({ data: [] }));
      const map: Record<number, string> = {};
      users.forEach((u: { id: number; name: string }) => { map[u.id] = u.name; });
      setPlayerNames(map);
    };
    fetchNames();
  }, []);

  const activeAP = store.players.find((p) => p.id === store.activePlayerId);
  const pendingPlayers = store.players.filter((p) => p.status === "pending");
  const soldPlayers = store.players.filter((p) => p.status === "sold");
  const unsoldPlayers = store.players.filter((p) => p.status === "unsold");

  const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
  const canStart =
    status !== "active" &&
    (!scheduledDate || scheduledDate <= new Date());

  const startAuction = () => api.post(`/auction/events/${eid}/start`).then(syncState);
  const pauseAuction = () => api.post(`/auction/events/${eid}/pause`).then(syncState);
  const nextPlayer = (playerId?: number) =>
    api.post(`/auction/events/${eid}/next-player`, { player_id: playerId || null }).catch((e) =>
      alert(e.response?.data?.detail || "Error")
    );
  const hammer = () => api.post(`/auction/events/${eid}/hammer`).catch(console.error);

  return (
    <div className="min-h-screen p-6 bg-gray-950">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold">Auctioneer Panel</h1>
            {scheduledDate && (
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
          <div className="flex flex-col items-end gap-1">
            {status !== "active" && (
              <button
                className={`btn-primary ${!canStart ? "opacity-50 cursor-not-allowed" : ""}`}
                onClick={startAuction}
                disabled={!canStart}
              >
                {status === "paused" ? "▶ Resume" : "▶ Start Auction"}
              </button>
            )}
            {!canStart && scheduledDate && (
              <p className="text-[11px] text-gray-500">
                Start button unlocks at the scheduled time.
              </p>
            )}
            {status === "active" && (
              <>
                <button className="btn-danger" onClick={pauseAuction}>⏸ Pause</button>
                <button className="btn-secondary" onClick={() => nextPlayer()}>
                  ⏭ Random Next
                </button>
                {activeAP && (
                  <button className="btn-primary" onClick={hammer}>
                    🔨 Hammer
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main auction area */}
          <div className="lg:col-span-2 space-y-6">
            {activeAP ? (
              <AuctionPlayerCard
                playerName={playerNames[activeAP.player_id] || `Player #${activeAP.player_id}`}
                basePrice={activeAP.base_price}
                currentBid={activeAP.current_bid}
                currentBidderName={
                  activeAP.current_bidder_id
                    ? playerNames[activeAP.current_bidder_id]
                    : undefined
                }
                timer={store.timer}
                status={activeAP.status}
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
              <TeamSummary teams={store.teams} />
            </div>
          </div>

          {/* Player queue */}
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-400 uppercase mb-2">
                Pending ({pendingPlayers.length})
              </h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {pendingPlayers.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between bg-gray-900 rounded-lg px-3 py-2"
                  >
                    <span className="text-sm">{playerNames[p.player_id] || `#${p.player_id}`}</span>
                    <button
                      className="text-xs btn-secondary py-1 px-2"
                      onClick={() => nextPlayer(p.id)}
                      disabled={status !== "active"}
                    >
                      Pick
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-400 uppercase mb-2">
                Sold ({soldPlayers.length})
              </h3>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {soldPlayers.map((p) => (
                  <div key={p.id} className="flex items-center justify-between bg-gray-900 rounded px-3 py-1.5">
                    <span className="text-sm">{playerNames[p.player_id] || `#${p.player_id}`}</span>
                    <span className="badge-sold">{p.current_bid}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-400 uppercase mb-2">
                Unsold ({unsoldPlayers.length})
              </h3>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {unsoldPlayers.map((p) => (
                  <div key={p.id} className="flex items-center justify-between bg-gray-900 rounded px-3 py-1.5">
                    <span className="text-sm">{playerNames[p.player_id] || `#${p.player_id}`}</span>
                    <span className="badge-unsold">Unsold</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
