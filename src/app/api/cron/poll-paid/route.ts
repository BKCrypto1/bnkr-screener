import { type NextRequest, NextResponse } from "next/server";
import { pollOnce } from "@/lib/paid-watcher";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  // Vercel Cron passes Authorization: Bearer <CRON_SECRET> on production invocations.
  // In development the header is absent — allow unauthenticated local calls.
  if (process.env.NODE_ENV !== "development") {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Distributed lock: if a previous invocation is still running, skip.
  // TTL is set to 55s so a hung invocation doesn't permanently block the cron.
  const { redis, K } = await import("@/lib/redis");
  const locked = await redis.set(K.cronLock, 1, { ex: 55, nx: true });
  if (!locked) {
    return NextResponse.json({ skipped: true, reason: "already running" });
  }

  try {
    const start = Date.now();
    await pollOnce();
    return NextResponse.json({ ok: true, ms: Date.now() - start });
  } finally {
    await redis.del(K.cronLock);
  }
}
