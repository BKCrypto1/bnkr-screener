import Link from "next/link";
import { redis, K } from "@/lib/redis";
import { StatsView } from "@/components/stats-view";
import type { RateBucket } from "@/components/launch-rate-chart";

export const revalidate = 60;

const BUCKET_MS = 15 * 60_000;
const BUCKETS_7D = 7 * 24 * 4; // 672 buckets

export default async function StatsPage() {
  const now = Date.now();
  const currentBucket = Math.floor(now / BUCKET_MS) * BUCKET_MS;
  const oldest = currentBucket - (BUCKETS_7D - 1) * BUCKET_MS;

  const raw = (await redis.hgetall<Record<string, number>>(K.launchRate).catch(() => null)) ?? {};

  // Prune keys older than 7 days (fire-and-forget)
  const staleKeys = Object.keys(raw).filter((k) => Number(k) < oldest);
  if (staleKeys.length > 0) {
    redis.hdel(K.launchRate, ...(staleKeys as [string, ...string[]])).catch(() => {});
  }

  const buckets: RateBucket[] = [];
  for (let i = 0; i < BUCKETS_7D; i++) {
    const ts = oldest + i * BUCKET_MS;
    const count = raw[String(ts)] ?? 0;
    buckets.push({ ts, count, isCurrent: ts === currentBucket });
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/" className="text-sm text-zinc-400 hover:text-zinc-100">← back to launches</Link>
          <h1 className="text-xl font-semibold mt-2">Launch Stats</h1>
        </div>
        <p className="text-xs text-zinc-500">15-min buckets · up to 7d · updates every minute</p>
      </div>

      <StatsView allBuckets={buckets} />
    </div>
  );
}
