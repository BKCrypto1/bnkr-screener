import { NextResponse } from "next/server";
import { fetchTrades } from "@/lib/geckoterminal";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ pool: string }> },
) {
  const { pool } = await params;
  try {
    const trades = await fetchTrades(pool);
    return NextResponse.json(
      { trades, fetchedAt: Date.now() },
      { headers: { "Cache-Control": "s-maxage=5, stale-while-revalidate=15" } },
    );
  } catch (err) {
    const m = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: m }, { status: 502 });
  }
}
