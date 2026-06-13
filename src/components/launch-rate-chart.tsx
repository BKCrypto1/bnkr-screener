"use client";

import { useState } from "react";

export type RateBucket = {
  ts: number;
  count: number;
  isCurrent: boolean;
};

export function LaunchRateChart({
  buckets,
  resolution = "15m",
}: {
  buckets: RateBucket[];
  resolution?: "15m" | "1h";
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const max = Math.max(...buckets.map((b) => b.count), 1);
  const CHART_H = 120;
  const LABEL_H = 24;
  // For 7d/1h resolution we have 168 bars — label every ~24 = once per day
  const labelEvery = resolution === "1h" ? 24 : 16;

  function fmtTime(ts: number) {
    const d = new Date(ts);
    const h = d.getHours();
    const ampm = h >= 12 ? "pm" : "am";
    const h12 = h % 12 || 12;
    return `${h12}${ampm}`;
  }

  function fmtDayLabel(ts: number) {
    const d = new Date(ts);
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return `${days[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
  }

  function fmtLabel(ts: number) {
    return resolution === "1h" ? fmtDayLabel(ts) : fmtTime(ts);
  }

  function fmtRange(ts: number) {
    if (resolution === "1h") {
      const d = new Date(ts);
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const h = d.getHours();
      const ampm = h >= 12 ? "pm" : "am";
      const h12 = h % 12 || 12;
      const nextH = (h + 1) % 24;
      const nextAmpm = nextH >= 12 ? "pm" : "am";
      const nextH12 = nextH % 12 || 12;
      return `${days[d.getDay()]} ${h12}${ampm}–${nextH12}${nextAmpm}`;
    }
    const end = ts + 15 * 60_000;
    return `${fmtTime(ts)} – ${fmtTime(end)}`;
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
              {fmtLabel(b.ts)}
            </span>
          );
        })}
      </div>
    </div>
  );
}
