"use client";

import { useState } from "react";

export type RateBucket = {
  ts: number;
  count: number;
  isCurrent: boolean;
};

export function LaunchRateChart({ buckets }: { buckets: RateBucket[] }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; bucket: RateBucket } | null>(null);
  const max = Math.max(...buckets.map((b) => b.count), 1);
  const CHART_H = 120;
  const LABEL_H = 20;
  const TOTAL_H = CHART_H + LABEL_H;

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

  // Show x-axis label every 16 buckets (4 hours)
  const labelEvery = 16;

  return (
    <div className="relative w-full select-none" style={{ height: TOTAL_H }}>
      <svg
        width="100%"
        height={TOTAL_H}
        viewBox={`0 0 ${buckets.length} ${TOTAL_H}`}
        preserveAspectRatio="none"
        className="overflow-visible"
      >
        {/* Gridlines */}
        {[0.25, 0.5, 0.75, 1].map((pct) => (
          <line
            key={pct}
            x1={0} y1={CHART_H - pct * CHART_H}
            x2={buckets.length} y2={CHART_H - pct * CHART_H}
            stroke="#27272a" strokeWidth="0.3"
          />
        ))}

        {/* Bars */}
        {buckets.map((b, i) => {
          const barH = (b.count / max) * CHART_H;
          const y = CHART_H - barH;
          const fill = b.count === 0
            ? "#18181b"
            : b.isCurrent
            ? "#a78bfa"
            : "#6d28d9";
          return (
            <rect
              key={b.ts}
              x={i + 0.1}
              y={y}
              width={0.8}
              height={Math.max(barH, b.count > 0 ? 0.5 : 0)}
              fill={fill}
              opacity={b.count > 0 ? 1 : 0.3}
              onMouseEnter={(e) => {
                const rect = (e.target as SVGRectElement).closest("svg")!.getBoundingClientRect();
                setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, bucket: b });
              }}
              onMouseLeave={() => setTooltip(null)}
              className="cursor-crosshair"
            />
          );
        })}

        {/* X-axis labels */}
        {buckets.map((b, i) => {
          if (i % labelEvery !== 0) return null;
          return (
            <text
              key={b.ts}
              x={i + 0.5}
              y={CHART_H + 14}
              textAnchor="middle"
              fontSize="3.5"
              fill="#71717a"
            >
              {fmtBucketTime(b.ts)}
            </text>
          );
        })}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute z-10 pointer-events-none bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs shadow-lg"
          style={{
            left: tooltip.x + 8,
            top: Math.max(0, tooltip.y - 40),
            transform: tooltip.x > (buckets.length * 0.7) ? "translateX(calc(-100% - 16px))" : undefined,
          }}
        >
          <div className="text-zinc-300 font-mono">{fmtRange(tooltip.bucket.ts)}</div>
          <div className="text-violet-300 font-semibold">{tooltip.bucket.count} launches</div>
          {tooltip.bucket.isCurrent && <div className="text-zinc-500 text-[10px]">in progress</div>}
        </div>
      )}
    </div>
  );
}
