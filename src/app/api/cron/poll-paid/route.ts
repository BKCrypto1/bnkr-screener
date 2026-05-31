import { type NextRequest, NextResponse } from "next/server";
import { fetchBankrLaunches } from "@/lib/bankr";
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
    const now = start;
    const BUCKET_MS = 15 * 60_000;

    const [newEntries, launches] = await Promise.all([
      pollOnce(),
      fetchBankrLaunches().catch(() => []),
    ]);
    const notified = await notify(newEntries);

    // Track launch rate — compare top-50 against last-seen timestamp
    if (launches.length > 0) {
      const lastTs = await redis.get<number>(K.lastLaunchTs).catch(() => null) ?? 0;
      const fresh = launches.filter((l) => l.timestamp > lastTs);
      if (fresh.length > 0) {
        const maxTs = Math.max(...fresh.map((l) => l.timestamp));
        const bucket = String(Math.floor(now / BUCKET_MS) * BUCKET_MS);
        await Promise.all([
          redis.hincrby(K.launchRate, bucket, fresh.length).catch(() => {}),
          redis.set(K.lastLaunchTs, maxTs).catch(() => {}),
        ]);
      }
    }

    return NextResponse.json({ ok: true, ms: Date.now() - start, new: newEntries.length, notified });
  } finally {
    await redis.del(K.cronLock);
  }
}
