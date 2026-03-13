"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth";
import api from "@/lib/api";
import EventCard from "@/components/EventCard";
import RolePicker from "@/components/RolePicker";
import Image from "next/image";
import brandLogo from "@/asset/Logo Png (3).png";

interface EventCardData {
  id: number;
  name: string;
  description: string | null;
  status: string;
  team_count: number;
  player_count: number;
  allowed_domains: string[];
  created_at: string;
  my_roles: string[];
  scheduled_at?: string | null;
  viewer_count?: number;
  logo?: string | null;
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, logout, isMultiRole, hasRole, activePanel } = useAuthStore();
  const [allEvents, setAllEvents] = useState<EventCardData[]>([]);
  const [myEvents, setMyEvents] = useState<EventCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRolePicker, setShowRolePicker] = useState(false);
  const [activeTab, setActiveTab] = useState<"all" | "mine">("all");
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  // Hydrate user from localStorage on first render
  useEffect(() => {
    if (!user && typeof window !== "undefined") {
      const stored = localStorage.getItem("user");
      const token = localStorage.getItem("token");
      if (!stored || !token) {
        router.push("/auth/login");
        return;
      }
      const parsedUser = JSON.parse(stored);
      useAuthStore.getState().setAuth(parsedUser, token);
    }
  }, [user, router]);

  const fetchEvents = useCallback(async () => {
    try {
      const [allRes, mineRes] = await Promise.all([
        api.get("/events"),
        api.get("/events/mine"),
      ]);
      setAllEvents(allRes.data);
      setMyEvents(mineRes.data);
    } catch {
      // token may be expired
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) fetchEvents();
  }, [user, fetchEvents]);

  // Sort events: live/active first, then upcoming (ready/paused), then completed
  // Within each group, sort by scheduled_at descending
  const sortEvents = (events: EventCardData[]) => {
    const statusPriority: Record<string, number> = {
      active: 0,
      paused: 1,
      ready: 2,
      draft: 3,
      completed: 4,
    };
    
    return [...events].sort((a, b) => {
      // First sort by status priority
      const priorityDiff = (statusPriority[a.status] ?? 5) - (statusPriority[b.status] ?? 5);
      if (priorityDiff !== 0) return priorityDiff;
      
      // Then sort by created_at descending (newest first)
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  };

  // Filter draft and completed events from "Upcoming Events" tab (only show ready/active/paused)
  const filteredAllEvents = allEvents.filter((e) => e.status !== "completed" && e.status !== "draft");
  
  // If activePanel is "captain", filter to only show events where user is captain
  const getFilteredMyEvents = () => {
    if (activePanel === "captain") {
      return myEvents.filter((e) => e.my_roles.includes("captain"));
    }
    return myEvents;
  };
  
  // When in captain mode, always show captain events; otherwise use tab selection
  const displayEvents = sortEvents(
    activePanel === "captain" 
      ? getFilteredMyEvents() 
      : (activeTab === "mine" ? getFilteredMyEvents() : filteredAllEvents)
  );

  return (
    <>
      {showRolePicker && <RolePicker onClose={() => setShowRolePicker(false)} />}

      <div className="min-h-screen bg-gray-950">
        {/* Top nav */}
        <header className="bg-gray-900 border-b border-gray-800 px-6 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Image src={brandLogo} alt="Cricket Auction" className="h-8 w-auto" />
              <span className="font-bold text-lg">Cricket Auction</span>
            </div>

            <div className="flex items-center gap-3">
              {/* Switch panel button for multi-role users */}
              {isMultiRole() && (
                <button
                  className="btn-secondary text-sm py-1.5 px-3"
                  onClick={() => setShowRolePicker(true)}
                >
                  Switch Panel
                </button>
              )}

              {/* Admin shortcut */}
              {hasRole("admin") && (
                <a href="/admin/events" className="btn-secondary text-sm py-1.5 px-3">
                  Admin
                </a>
              )}

              {/* Profile dropdown (Profile + Logout) */}
              <div className="relative">
                <button
                  type="button"
                  data-testid="profile-menu-trigger"
                  className="flex items-center gap-2 hover:bg-gray-800 rounded-full px-2 py-1 transition"
                  onClick={() => setShowProfileMenu((v) => !v)}
                  aria-haspopup="menu"
                  aria-expanded={showProfileMenu}
                >
                  <div className="w-8 h-8 rounded-full bg-gray-800 border border-gray-700 overflow-hidden flex items-center justify-center">
                    {user?.profile_photo ? (
                      <img src={user.profile_photo} alt="avatar" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-sm">👤</span>
                    )}
                  </div>
                  <span className="text-sm text-gray-400 hidden sm:block">{user?.name}</span>
                </button>

                {showProfileMenu && (
                  <div
                    className="absolute right-0 mt-2 w-64 bg-gray-900 border border-gray-800 rounded-2xl shadow-xl z-20"
                    role="menu"
                  >
                    <div className="px-4 py-3 border-b border-gray-800">
                      <p className="text-sm font-medium text-white truncate">{user?.name}</p>
                      <p className="text-xs text-gray-500 truncate">{user?.email}</p>
                    </div>

                    <button
                      type="button"
                      className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-200 hover:bg-gray-800"
                      onClick={() => {
                        setShowProfileMenu(false);
                        router.push("/onboarding");
                      }}
                      role="menuitem"
                    >
                      <span>Profile</span>
                      <span className="text-gray-500 text-xs">Edit details</span>
                    </button>

                    <div className="border-t border-gray-800 mt-1" />

                    <button
                      type="button"
                      className="w-full px-4 py-3 text-sm text-red-400 hover:bg-red-500/10"
                      onClick={() => {
                        setShowProfileMenu(false);
                        logout();
                        router.push("/");
                      }}
                      role="menuitem"
                    >
                      Logout
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-6 py-8">
          {/* Hero greeting */}
          <div className="mb-8">
            <h1 className="text-3xl font-extrabold mb-1">
              {activePanel === "captain" ? "Captain Dashboard ⚡" : `Hey ${user?.name?.split(" ")[0]} 👋`}
            </h1>
            <p className="text-gray-500">
              {activePanel === "captain"
                ? `You're captain in ${getFilteredMyEvents().length} event${getFilteredMyEvents().length !== 1 ? "s" : ""}.`
                : myEvents.length > 0
                ? `You're part of ${myEvents.length} auction event${myEvents.length > 1 ? "s" : ""}.`
                : "Browse events below or wait to be added by an organizer."}
            </p>
          </div>

          {/* Tab switcher - hide when in captain mode */}
          {activePanel !== "captain" && (
            <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit mb-6">
              {(["all", "mine"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === tab
                      ? "bg-amber-500 text-black"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  {tab === "all" ? "Upcoming Events" : `My Events${myEvents.length > 0 ? ` (${myEvents.length})` : ""}`}
                </button>
              ))}
            </div>
          )}

          {/* Events grid */}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="bg-gray-900 border border-gray-800 rounded-2xl h-44 animate-pulse" />
              ))}
            </div>
          ) : displayEvents.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-5xl mb-4">🏟️</p>
              <p className="text-xl font-semibold text-gray-400">
                {activeTab === "mine" ? "You're not part of any event yet." : "No events found."}
              </p>
              {activeTab === "mine" && (
                <p className="text-gray-600 mt-2">
                  Ask an organizer to add you, or{" "}
                  <button
                    onClick={() => setActiveTab("all")}
                    className="text-amber-400 hover:underline"
                  >
                    browse all events
                  </button>
                  .
                </p>
              )}
              {hasRole("admin") && activeTab === "all" && (
                <a href="/admin/events" className="btn-primary inline-block mt-4">
                  Create First Event
                </a>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {displayEvents.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          )}
        </main>
      </div>
    </>
  );
}
