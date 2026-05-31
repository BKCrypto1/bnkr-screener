import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "bnkrscreener — Bankr launches",
  description:
    "Lightweight live screener for tokens launched via Bankr on Base.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">
        <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-10">
          <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-violet-400 font-mono text-lg font-semibold tracking-tight">
                bnkrscreener
              </span>
              <span className="text-xs text-zinc-500 hidden sm:inline">
                Bankr launches on Base
              </span>
            </Link>
            <nav className="flex items-center gap-4 text-sm text-zinc-400">
              <a
                href="https://bankr.bot/launches"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-zinc-100"
              >
                bankr.bot ↗
              </a>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
