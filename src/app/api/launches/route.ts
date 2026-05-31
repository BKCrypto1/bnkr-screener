import { NextResponse } from "next/server";
import { getEnrichedLaunchesResult } from "@/lib/enrich";

export const revalidate = 3;

export async function GET() {
  try {
    const { launches, extraPaid } = await getEnrichedLaunchesResult();
    return NextResponse.json(
      { launches, extraPaid, fetchedAt: Date.now() },
      {
        headers: {
          "Cache-Control": "s-maxage=3, stale-while-revalidate=10",
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
