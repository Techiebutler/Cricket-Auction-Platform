import type { Metadata } from "next";
import "./globals.css";
import faviconPng from "@/asset/Favi PNG.png";

export const metadata: Metadata = {
  title: "Cricket Auction",
  description: "IPL-style cricket auction platform",
  icons: {
    icon: [{ url: faviconPng.src, type: "image/png" }],
    shortcut: [{ url: faviconPng.src, type: "image/png" }],
    apple: [{ url: faviconPng.src, type: "image/png" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
