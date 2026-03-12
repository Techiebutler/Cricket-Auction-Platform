"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
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
}

export default function CaptainPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const eid = parseInt(eventId);
  const store = useAuctionStore();
  const user = useAuthStore((s) => s.user);
  const [myTeam, setMyTeam] = useState<TeamDetail | null>(null);
  const [playerNames, setPlayerNames] = useState<Record<number, string>>({});
  const [bidAmount, setBidAmount] = useState("");
  const [bidError, setBidError] = useState("");
  const [bidding, setBidding] = useState(false);
  const [eventMeta, setEventMeta] = useState<EventMeta | null>(null);
  const [bookmarked, setBookmarked] = useState<number[]>([]);

  const syncState = useCallback(async () => {
    const [stateRes, teamRes, eventRes] = await Promise.all([
      api.get(`/auction/events/${eid}/state`),
      api.get(`/auction/events/${eid}/my-team`).catch(() => ({ data: null })),
      api.get(`/auction/events/${eid}`).catch(() => ({ data: null })),
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
        setBidAmount((prev) => {
          const currentBid = msg.amount as number;
          const next = (parseInt(prev) || currentBid);
          return next <= currentBid ? (currentBid + 50).toString() : prev;
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
        setBidAmount(((msg.base_price as number) + 50).toString());
        setBidError("");
      }
      if (msg.type === "auction_resumed") {
        store.setFullState({ status: "active" });
      }
      if (msg.type === "auction_paused") {
        store.setFullState({ status: "paused" });
      }
    });

    api.get(`/auction/events/${eid}/players-info`).then(({ data }) => {
      const map: Record<number, string> = {};
      data.forEach((row: { player_id: number; name: string }) => { map[row.player_id] = row.name; });
      setPlayerNames(map);
    }).catch(() => {});

    setSocket(ws);
    return () => ws.disconnect();
  }, [eid]);

  const [socket, setSocket] = useState<AuctionSocket | null>(null);

  const activeAP = store.players.find((p) => p.id === store.activePlayerId);
  const remaining = myTeam ? myTeam.budget - myTeam.spent : 0;
  const pendingPlayers = store.players.filter(
    (p) => p.status === "pending" && p.player_id !== user?.id
  );

  const placeBid = async () => {
    if (!bidAmount) return;
    setBidding(true);
    setBidError("");
    try {
      await api.post(`/auction/events/${eid}/bid`, { amount: parseInt(bidAmount) });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setBidError(msg || "Bid failed");
    } finally {
      setBidding(false);
    }
  };

  const isMyBid = activeAP?.current_bidder_id === user?.id;

  const toggleBookmark = (id: number) => {
    setBookmarked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  return (
    <div className="min-h-screen p-6 bg-gray-950">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold">
              {myTeam ? myTeam.name : "Captain View"}
            </h1>
            {eventMeta?.scheduled_at && (
              <p className="text-xs text-gray-500 mt-1">
                Auction:&nbsp;
                {new Date(eventMeta.scheduled_at).toLocaleString("en-IN", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            )}
          </div>
          {myTeam && (
            <div className="flex gap-6 text-center">
              <div>
                <p className="text-2xl font-bold text-amber-400">{remaining}</p>
                <p className="text-xs text-gray-500">Budget Left</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{myTeam.players.length}/{myTeam.max_players}</p>
                <p className="text-xs text-gray-500">Players</p>
              </div>
              <div>
                <p className={`text-xs font-semibold uppercase ${store.status === "active" ? "text-green-400" : "text-gray-500"}`}>
                  {store.status === "active" ? "Live" : store.status}
                </p>
                <div className={`w-2 h-2 rounded-full mx-auto mt-1 ${store.status === "active" ? "bg-green-400 animate-pulse" : "bg-red-500"}`} />
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Active player + bidding */}
          <div className="lg:col-span-2 space-y-4">
            {activeAP ? (
              <>
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

                {isMyBid && (
                  <div className="bg-green-500/20 border border-green-500/30 rounded-xl p-4 text-center">
                    <p className="text-green-400 font-semibold">You have the highest bid!</p>
                  </div>
                )}

                <div className="card">
                  <label className="label">Your Bid Amount</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      className="input"
                      value={bidAmount}
                      onChange={(e) => setBidAmount(e.target.value)}
                      placeholder="Enter amount"
                      min={activeAP.current_bid + 1}
                    />
                    <button
                      className="btn-primary whitespace-nowrap"
                      onClick={placeBid}
                      disabled={bidding || !activeAP}
                    >
                      {bidding ? "..." : "Bid"}
                    </button>
                  </div>
                  {bidError && <p className="text-red-400 text-sm mt-2">{bidError}</p>}

                  {/* Quick bid buttons */}
                  <div className="flex gap-2 mt-3">
                    {[50, 100, 200, 500].map((inc) => (
                      <button
                        key={inc}
                        className="btn-secondary text-xs px-2 py-1"
                        onClick={() =>
                          setBidAmount(((activeAP.current_bid || activeAP.base_price) + inc).toString())
                        }
                      >
                        +{inc}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="card text-center py-16 text-gray-500">
                <p className="text-4xl mb-3">⏳</p>
                <p>Waiting for next player...</p>
              </div>
            )}
          </div>

          {/* Side panel: My team + upcoming */}
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-3">My Team Roster</h3>
              {myTeam && myTeam.players.length > 0 ? (
                <div className="space-y-2">
                  {myTeam.players.map((tp) => (
                    <div key={tp.id} className="flex items-center justify-between bg-gray-900 rounded-lg px-3 py-2">
                      <span className="text-sm">{playerNames[tp.player_id] || `Player #${tp.player_id}`}</span>
                      <span className="badge-sold">{tp.sold_price}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="card text-center py-8 text-gray-500 text-sm">
                  No players yet. Start bidding!
                </div>
              )}
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-400 uppercase mb-2">
                Upcoming Players
              </h3>
              {pendingPlayers.length === 0 ? (
                <p className="text-xs text-gray-600">No remaining players.</p>
              ) : (
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {pendingPlayers.map((p) => (
                    <button
                      key={p.id}
                      className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-left text-xs ${
                        bookmarked.includes(p.id) ? "bg-amber-500/10 border border-amber-500/40" : "bg-gray-900 border border-gray-800"
                      }`}
                      onClick={() => toggleBookmark(p.id)}
                    >
                      <span className="truncate">
                        {playerNames[p.player_id] || `Player #${p.player_id}`}
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="text-gray-500">★</span>
                        {bookmarked.includes(p.id) && (
                          <span className="text-amber-400 text-[10px]">Bookmarked</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
