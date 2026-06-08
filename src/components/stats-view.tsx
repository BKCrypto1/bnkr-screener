"use client";

import { useState, useMemo } from "react";
import { LaunchRateChart, type RateBucket } from "@/components/launch-rate-chart";

type Range = "1h" | "24h" | "7d";

export function StatsView({ allBuckets }: { allBuckets: RateBucket[] }) {
  const [range, setRange] = useState<Range>("24h");

  const { buckets, resolution, totalLabel, peakLabel } = useMemo(() => {
    const now = allBuckets[allBuckets.length - 1]?.ts ?? Date.now();

    if (range === "1h") {
      const slice = allBuckets.slice(-4);
      return {
        buckets: slice,
        resolution: "15m" as const,
        totalLabel: "Last 1h",
        peakLabel: "Peak 15 min",
      };
    }

    if (range === "24h") {
      const slice = allBuckets.slice(-96);
      return {
        buckets: slice,
        resolution: "15m" as const,
        totalLabel: "Last 24h",
        peakLabel: "Peak 15 min",
      };
    }

    // 7d — aggregate 15-min buckets into 1-hour buckets
    const HOUR_MS = 60 * 60_000;
    const sevenDaysAgo = now - 7 * 24 * HOUR_MS;
    const relevant = allBuckets.filter((b) => b.ts >= sevenDaysAgo);
    const hourMap = new Map<number, number>();
    for (const b of relevant) {
      const hourTs = Math.floor(b.ts / HOUR_MS) * HOUR_MS;
      hourMap.set(hourTs, (hourMap.get(hourTs) ?? 0) + b.count);
    }
    const currentHourTs = Math.floor(now / HOUR_MS) * HOUR_MS;
    const hourBuckets: RateBucket[] = [];
    for (let i = 0; i < 168; i++) {
      const ts = (Math.floor(sevenDaysAgo / HOUR_MS) + i) * HOUR_MS;
      hourBuckets.push({
        ts,
        count: hourMap.get(ts) ?? 0,
        isCurrent: ts === currentHourTs,
      });
    }
    return {
      buckets: hourBuckets,
      resolution: "1h" as const,
      totalLabel: "Last 7d",
      peakLabel: "Peak 1h",
    };
  }, [allBuckets, range]);

  const total = buckets.reduce((s, b) => s + b.count, 0);
  const peak = Math.max(...buckets.map((b) => b.count), 0);
  const currentWindow = buckets[buckets.length - 1]?.count ?? 0;

  // Compare current period vs previous same-length period
  const half = Math.floor(buckets.length / 2);
  const recent = buckets.slice(-half).reduce((s, b) => s + b.count, 0);
  const prior = buckets.slice(-half * 2, -half).reduce((s, b) => s + b.count, 0);
  const trendLabel = prior > 0 ? `${recent > prior ? "↑" : "↓"} vs prev` : undefined;

  const currentLabel = range === "1h" ? "Last 15 min" : range === "24h" ? "Last 15 min" : "Last 1h";
  const totalPeriodLabel = range === "1h" ? "Total 1h" : range === "24h" ? "Total 24h" : "Total 7d";

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1">
          <StatCard
            label={currentLabel}
            value={String(currentWindow)}
            sub="in progress"
            highlight={total > 0 && currentWindow > (total / buckets.length) * 1.5}
          />
          <StatCard label="Recent half" value={String(recent)} sub={trendLabel} />
          <StatCard label={peakLabel} value={String(peak)} sub={`in ${range}`} />
          <StatCard label={totalPeriodLabel} value={String(total)} sub="launches tracked" />
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 pt-4 pb-2">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs uppercase tracking-wide text-zinc-500">
            Launches per {resolution === "15m" ? "15 min" : "hour"}
          </span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-zinc-600">
              <span className="inline-block w-2 h-2 rounded-sm bg-violet-500" /> historical
              <span className="inline-block w-2 h-2 rounded-sm bg-violet-400 ml-1" /> current
            </div>
            <RangeToggle value={range} onChange={setRange} />
          </div>
        </div>
        {total === 0 ? (
          <div className="h-32 flex items-center justify-center text-zinc-600 text-sm">
            {range === "7d"
              ? "Not enough history yet — check back after data accumulates"
              : "Collecting data — check back after the next cron run"}
          </div>
        ) : (
          <LaunchRateChart buckets={buckets} resolution={resolution} />
        )}
      </div>
    </>
  );
}

function RangeToggle({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const options: Range[] = ["1h", "24h", "7d"];
  return (
    <div className="flex items-center rounded border border-zinc-700 overflow-hidden text-xs">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`px-2.5 py-1 transition-colors ${
            value === opt
              ? "bg-violet-600 text-white"
              : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {opt}
        </button>
      ))}
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
