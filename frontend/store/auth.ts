import { create } from "zustand";

export interface User {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  roles: string[];
  profile_photo: string | null;
  batting_rating: number;
  bowling_rating: number;
  fielding_rating: number;
  onboarded: boolean;
}

interface AuthState {
  user: User | null;
  token: string | null;
  activePanel: string | null; // which panel the user chose to enter
  setAuth: (user: User, token: string) => void;
  setActivePanel: (panel: string) => void;
  logout: () => void;
  hasRole: (role: string) => boolean;
  isMultiRole: () => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  activePanel: null,

  setAuth: (user, token) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("token", token);
      localStorage.setItem("user", JSON.stringify(user));
    }
    set({ user, token });
  },

  setActivePanel: (panel) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("activePanel", panel);
    }
    set({ activePanel: panel });
  },

  logout: () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      localStorage.removeItem("activePanel");
    }
    set({ user: null, token: null, activePanel: null });
  },

  hasRole: (role) => {
    const roles = get().user?.roles ?? ["player"];
    return roles.includes(role);
  },

  isMultiRole: () => {
    const roles = get().user?.roles ?? ["player"];
    // Has more than just "player"
    return roles.length > 1;
  },
}));
