"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LandingPage() {
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) router.push("/dashboard");
  }, [router]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
      <div className="text-center max-w-2xl">
        <div className="text-8xl mb-6 select-none">🏏</div>

        <h1 className="text-5xl font-extrabold mb-4 bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
          Cricket Auction
        </h1>
        <p className="text-xl text-gray-400 mb-10">
          Experience the thrill of an IPL-style player auction — live bidding,
          real-time updates, and the ultimate team-building challenge for your office.
        </p>

        <div className="flex gap-4 justify-center">
          <Link href="/auth/login" className="btn-primary text-lg px-8 py-3">
            Sign In
          </Link>
          <Link href="/auth/signup" className="btn-secondary text-lg px-8 py-3">
            Register
          </Link>
        </div>
      </div>

      <footer className="absolute bottom-6 flex items-center gap-4 text-gray-700 text-sm">
        <span>Powered by Techiebutler</span>
        <span>·</span>
        {/* Hidden admin bootstrap link */}
        <Link href="/godmode" className="hover:text-gray-500 transition-colors">
          ⚙
        </Link>
      </footer>
    </main>
  );
}
