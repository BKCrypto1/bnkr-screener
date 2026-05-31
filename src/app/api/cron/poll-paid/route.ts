import { type NextRequest, NextResponse } from "next/server";
import { pollOnce } from "@/lib/paid-watcher";
import type { PaidEntry } from "@/lib/paid-watcher";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function notify(entries: PaidEntry[]) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic || entries.length === 0) return;
  for (const e of entries) {
    const name = e.bankr?.tokenName ?? e.address;
    const symbol = e.bankr?.tokenSymbol ?? "";
    const kind = e.boostAmount > 0 && e.hasProfile ? "⚡💎 Boost + Profile"
      : e.boostAmount > 0 ? `⚡ Boosted ${e.boostAmount}x`
      : "💎 Paid Profile";
    const url = `https://bnkrscreener.vercel.app/token/${e.address}`;
    await fetch(`https://ntfy.sh/${topic}`, {
      method: "POST",
      headers: {
        "Title": `${kind} — ${name} ${symbol}`.trim(),
        "Click": url,
        "Priority": "high",
      },
      body: url,
    }).catch(() => {});
  }
}

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const { redis, K } = await import("@/lib/redis");
  const locked = await redis.set(K.cronLock, 1, { ex: 55, nx: true });
  if (!locked) {
    return NextResponse.json({ skipped: true, reason: "already running" });
  }

  try {
    const start = Date.now();
    const newEntries = await pollOnce();
    await notify(newEntries);
    return NextResponse.json({ ok: true, ms: Date.now() - start, notified: newEntries.length });
  } finally {
    await redis.del(K.cronLock);
  }
}
