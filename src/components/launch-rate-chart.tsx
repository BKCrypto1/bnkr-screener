"use client";

import { useState } from "react";

export type RateBucket = {
  ts: number;
  count: number;
  isCurrent: boolean;
};

export function LaunchRateChart({ buckets }: { buckets: RateBucket[] }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const max = Math.max(...buckets.map((b) => b.count), 1);
  const CHART_H = 120;
  const LABEL_H = 24;
  const labelEvery = 16;

  function fmtBucketTime(ts: number) {
    const d = new Date(ts);
    const h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? "pm" : "am";
    const h12 = h % 12 || 12;
    return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
  }

  function fmtRange(ts: number) {
    return `${fmtBucketTime(ts)} – ${fmtBucketTime(ts + 15 * 60_000)}`;
  }

  const hoveredBucket = hoveredIdx !== null ? buckets[hoveredIdx] : null;

  return (
    <div className="w-full select-none">
      {/* Chart area */}
      <div className="relative w-full" style={{ height: CHART_H }}>
        {/* Gridlines */}
        {[0.25, 0.5, 0.75, 1].map((pct) => (
          <div
            key={pct}
            className="absolute left-0 right-0"
            style={{ bottom: `${pct * 100}%`, borderTop: "1px solid #27272a" }}
          />
        ))}

        {/* Bars */}
        <div className="absolute inset-0 flex items-end" style={{ gap: "1px" }}>
          {buckets.map((b, i) => {
            const heightPct = b.count > 0 ? Math.max((b.count / max) * 100, 0.5) : 0;
            const bg = b.count === 0 ? "#18181b" : b.isCurrent ? "#a78bfa" : "#6d28d9";
            return (
              <div
                key={b.ts}
                className="flex-1 flex items-end cursor-crosshair"
                style={{ height: "100%" }}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
              >
                <div
                  className="w-full"
                  style={{
                    height: b.count > 0 ? `${heightPct}%` : "2px",
                    backgroundColor: bg,
                    opacity: b.count > 0 ? 1 : 0.3,
                  }}
                />
              </div>
            );
          })}
        </div>

        {/* Tooltip */}
        {hoveredBucket !== null && hoveredIdx !== null && (
          <div
            className="absolute z-10 pointer-events-none bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs shadow-lg"
            style={{
              bottom: "calc(100% + 6px)",
              left: `${((hoveredIdx + 0.5) / buckets.length) * 100}%`,
              transform: hoveredIdx > buckets.length * 0.7 ? "translateX(-100%)" : "translateX(-50%)",
            }}
          >
            <div className="text-zinc-300 font-mono whitespace-nowrap">{fmtRange(hoveredBucket.ts)}</div>
            <div className="text-violet-300 font-semibold">{hoveredBucket.count} launches</div>
            {hoveredBucket.isCurrent && <div className="text-zinc-500 text-[10px]">in progress</div>}
          </div>
        )}
      </div>

      {/* X-axis labels */}
      <div className="relative w-full" style={{ height: LABEL_H }}>
        {buckets.map((b, i) => {
          if (i % labelEvery !== 0) return null;
          return (
            <span
              key={b.ts}
              className="absolute text-[10px] text-zinc-500 -translate-x-1/2 whitespace-nowrap"
              style={{ left: `${((i + 0.5) / buckets.length) * 100}%`, top: 4 }}
            >
              {fmtBucketTime(b.ts)}
            </span>
          );
        })}
      </div>
    </div>
  );
}
