import { NextResponse } from "next/server";
import { fetchOhlcv, type Timeframe } from "@/lib/geckoterminal";

export const dynamic = "force-dynamic";

const TIMEFRAMES: Record<string, { tf: Timeframe; agg: number }> = {
  "1m": { tf: "minute", agg: 1 },
  "5m": { tf: "minute", agg: 5 },
  "15m": { tf: "minute", agg: 15 },
  "1h": { tf: "hour", agg: 1 },
  "4h": { tf: "hour", agg: 4 },
  "1d": { tf: "day", agg: 1 },
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ pool: string }> },
) {
  const { pool } = await params;
  const url = new URL(req.url);
  const tfKey = url.searchParams.get("tf") ?? "1m";
  const cfg = TIMEFRAMES[tfKey] ?? TIMEFRAMES["1m"];
  try {
    const candles = await fetchOhlcv(pool, cfg.tf, cfg.agg, 500);
    return NextResponse.json(
      { candles, fetchedAt: Date.now() },
      { headers: { "Cache-Control": "s-maxage=10, stale-while-revalidate=30" } },
    );
  } catch (err) {
    const m = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: m }, { status: 502 });
  }
}
