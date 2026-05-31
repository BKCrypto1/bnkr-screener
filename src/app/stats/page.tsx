import Link from "next/link";
import { redis, K } from "@/lib/redis";
import { LaunchRateChart, type RateBucket } from "@/components/launch-rate-chart";

export const revalidate = 60;

const BUCKET_MS = 15 * 60_000;
const BUCKETS_24H = 96;

export default async function StatsPage() {
  const now = Date.now();
  const currentBucket = Math.floor(now / BUCKET_MS) * BUCKET_MS;
  const oldest = currentBucket - (BUCKETS_24H - 1) * BUCKET_MS;

  const raw = (await redis.hgetall<Record<string, number>>(K.launchRate).catch(() => null)) ?? {};

  // Prune stale keys older than 24h (fire-and-forget)
  const staleKeys = Object.keys(raw).filter((k) => Number(k) < oldest);
  if (staleKeys.length > 0) {
    redis.hdel(K.launchRate, ...(staleKeys as [string, ...string[]])).catch(() => {});
  }

  const buckets: RateBucket[] = [];
  let total24h = 0;
  let peak = 0;
  for (let i = 0; i < BUCKETS_24H; i++) {
    const ts = oldest + i * BUCKET_MS;
    const count = raw[String(ts)] ?? 0;
    total24h += count;
    if (count > peak) peak = count;
    buckets.push({ ts, count, isCurrent: ts === currentBucket });
  }

  const lastHour = buckets.slice(-4).reduce((s, b) => s + b.count, 0);
  const prevHour = buckets.slice(-8, -4).reduce((s, b) => s + b.count, 0);
  const currentWindow = buckets[buckets.length - 1].count;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/" className="text-sm text-zinc-400 hover:text-zinc-100">← back to launches</Link>
          <h1 className="text-xl font-semibold mt-2">Launch Stats</h1>
        </div>
        <p className="text-xs text-zinc-500">15-min buckets · last 24h · updates every minute</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Last 15 min" value={String(currentWindow)} sub="in progress" highlight={currentWindow > (total24h / 96) * 1.5} />
        <StatCard label="Last hour" value={String(lastHour)} sub={prevHour > 0 ? `${prevHour > lastHour ? "↓" : "↑"} vs prev hour` : undefined} />
        <StatCard label="Peak 15 min" value={String(peak)} sub="in last 24h" />
        <StatCard label="Total 24h" value={String(total24h)} sub="launches tracked" />
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 pt-4 pb-2">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs uppercase tracking-wide text-zinc-500">Launches per 15 min</span>
          <span className="text-xs text-zinc-600 flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-sm bg-violet-500" /> historical
            <span className="inline-block w-2 h-2 rounded-sm bg-violet-400 ml-1" /> current window
          </span>
        </div>
        {total24h === 0 ? (
          <div className="h-32 flex items-center justify-center text-zinc-600 text-sm">
            Collecting data — check back after the next cron run
          </div>
        ) : (
          <LaunchRateChart buckets={buckets} />
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 font-mono text-2xl font-semibold ${highlight ? "text-violet-400" : ""}`}>{value}</div>
      {sub && <div className="text-xs text-zinc-600 mt-0.5">{sub}</div>}
    </div>
  );
}
