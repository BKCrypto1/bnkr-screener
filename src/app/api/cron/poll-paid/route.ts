import { type NextRequest, NextResponse } from "next/server";
import { pollOnce } from "@/lib/paid-watcher";
import type { PaidEntry } from "@/lib/paid-watcher";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function notify(entries: PaidEntry[]): Promise<number> {
  const topic = process.env.NTFY_TOPIC;
  if (!topic || entries.length === 0) return 0;
  let sent = 0;
  for (const e of entries) {
    const name = e.bankr?.tokenName ?? e.address;
    const symbol = e.bankr?.tokenSymbol ?? "";
    const kind = e.boostAmount > 0 && e.hasProfile ? "⚡💎 Boost + Profile"
      : e.boostAmount > 0 ? `⚡ Boosted ${e.boostAmount}x`
      : "💎 Paid Profile";
    const url = `https://bnkrscreener.vercel.app/token/${e.address}`;
    const ok = await fetch(`https://ntfy.sh/${topic}`, {
      method: "POST",
      headers: {
        "Title": `${kind} — ${name} ${symbol}`.trim(),
        "Click": url,
        "Priority": "high",
      },
      body: url,
    }).then((r) => r.ok).catch(() => false);
    if (ok) sent++;
  }
  return sent;
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
    const notified = await notify(newEntries);
    return NextResponse.json({ ok: true, ms: Date.now() - start, new: newEntries.length, notified });
  } finally {
    await redis.del(K.cronLock);
  }
}
