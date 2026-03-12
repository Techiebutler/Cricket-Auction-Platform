"use client";

import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth";

const ROLE_CONFIG: Record<string, { label: string; description: string; icon: string; href: string }> = {
  admin: {
    label: "Admin Panel",
    description: "Create & manage auction events",
    icon: "🛡️",
    href: "/admin/events",
  },
  organizer: {
    label: "Organizer Panel",
    description: "Set up teams, players & rosters",
    icon: "📋",
    href: "/organizer/events",
  },
  auctioneer: {
    label: "Auctioneer Panel",
    description: "Control the live auction",
    icon: "🔨",
    href: "/organizer/events",
  },
  captain: {
    label: "Captain View",
    description: "Bid for players, track your squad",
    icon: "⚡",
    href: "/dashboard",
  },
  player: {
    label: "Player Dashboard",
    description: "Browse events, spectate auctions",
    icon: "🏏",
    href: "/dashboard",
  },
};

interface Props {
  onClose?: () => void;
}

export default function RolePicker({ onClose }: Props) {
  const router = useRouter();
  const { user, setActivePanel } = useAuthStore();
  const roles = Array.from(new Set(user?.roles ?? ["player"])); // de-dupe roles

  const handlePick = (role: string) => {
    setActivePanel(role);
    const config = ROLE_CONFIG[role];
    if (onClose) onClose();
    router.push(config?.href ?? "/dashboard");
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 w-full max-w-lg shadow-2xl">
        <h2 className="text-2xl font-bold mb-2">Welcome back, {user?.name}</h2>
        <p className="text-gray-500 mb-6">
          You have multiple roles. Choose which view to enter:
        </p>

        <div className="space-y-3">
          {roles.map((role) => {
            const config = ROLE_CONFIG[role];
            if (!config) return null;
            return (
              <button
                key={role}
                onClick={() => handlePick(role)}
                className="w-full flex items-center gap-4 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-amber-500/50 rounded-xl p-4 transition-all text-left group"
              >
                <span className="text-3xl">{config.icon}</span>
                <div className="flex-1">
                  <p className="font-semibold group-hover:text-amber-400 transition-colors">
                    {config.label}
                  </p>
                  <p className="text-sm text-gray-500">{config.description}</p>
                </div>
                <span className="text-gray-600 group-hover:text-amber-400 transition-colors">→</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
