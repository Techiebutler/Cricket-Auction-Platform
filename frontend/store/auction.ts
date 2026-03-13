import { create } from "zustand";

export interface TeamState {
  id: number;
  name: string;
  color: string;
  captain_id: number | null;
  budget: number;
  spent: number;
  max_players: number;
  player_count: number;
}

export interface PlayerState {
  id: number;
  player_id: number;
  base_price: number;
  current_bid: number;
  current_bidder_id: number | null;
  status: "pending" | "active" | "sold" | "unsold";
}

interface AuctionState {
  eventId: number | null;
  status: string;
  timer: number;
  activePlayerId: number | null;
  teams: TeamState[];
  players: PlayerState[];
  setFullState: (state: Partial<AuctionState>) => void;
  updateBid: (auctionPlayerId: number, amount: number, captainId: number) => void;
  setTimer: (remaining: number) => void;
  markPlayerSold: (auctionPlayerId: number, captainId: number, price: number) => void;
  markPlayerUnsold: (auctionPlayerId: number) => void;
  setActivePlayer: (auctionPlayerId: number, basePrice: number) => void;
}

export const useAuctionStore = create<AuctionState>((set) => ({
  eventId: null,
  status: "draft",
  timer: 0,
  activePlayerId: null,
  teams: [],
  players: [],

  setFullState: (state) => set((prev) => ({ ...prev, ...state })),

  updateBid: (auctionPlayerId, amount, captainId) =>
    set((prev) => ({
      players: prev.players.map((p) =>
        p.id === auctionPlayerId
          ? { ...p, current_bid: amount, current_bidder_id: captainId }
          : p
      ),
    })),

  setTimer: (remaining) => set({ timer: remaining }),

  markPlayerSold: (auctionPlayerId, captainId, price) =>
    set((prev) => ({
      players: prev.players.map((p) =>
        p.id === auctionPlayerId ? { ...p, status: "sold" as const } : p
      ),
      teams: prev.teams.map((t) =>
        t.captain_id === captainId
          ? { ...t, spent: t.spent + price, player_count: t.player_count + 1 }
          : t
      ),
    })),

  markPlayerUnsold: (auctionPlayerId) =>
    set((prev) => ({
      players: prev.players.map((p) =>
        p.id === auctionPlayerId ? { ...p, status: "unsold" as const } : p
      ),
    })),

  setActivePlayer: (auctionPlayerId, basePrice) =>
    set((prev) => ({
      activePlayerId: auctionPlayerId,
      players: prev.players.map((p) =>
        p.id === auctionPlayerId
          ? { ...p, status: "active" as const, current_bid: basePrice }
          : p
      ),
    })),
}));
