"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  IChartApi,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  SeriesMarker,
  Time,
  UTCTimestamp,
} from "lightweight-charts";
import type { Candle, GtTrade } from "@/lib/geckoterminal";

const TIMEFRAMES: { key: string; label: string }[] = [
  { key: "1m", label: "1m" },
  { key: "5m", label: "5m" },
  { key: "15m", label: "15m" },
  { key: "1h", label: "1h" },
  { key: "4h", label: "4h" },
  { key: "1d", label: "1d" },
];

export function PriceChart({
  pool,
  highlightWallet,
}: {
  pool: string;
  highlightWallet?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const [tf, setTf] = useState<string>("1m");
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">(
    "loading",
  );
  const [errMsg, setErrMsg] = useState<string>("");

  // Init chart once
  useEffect(() => {
    if (!containerRef.current) return;
    let resizeObserver: ResizeObserver | null = null;
    let cancelled = false;

    (async () => {
      const lwc = await import("lightweight-charts");
      if (cancelled || !containerRef.current) return;
      const chart = lwc.createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height: 480,
        layout: {
          background: { color: "#0a0a0a" },
          textColor: "#a1a1aa",
          fontFamily:
            "var(--font-geist-mono), ui-monospace, SFMono-Regular, monospace",
        },
        grid: {
          vertLines: { color: "#18181b" },
          horzLines: { color: "#18181b" },
        },
        rightPriceScale: { borderColor: "#27272a" },
        timeScale: {
          borderColor: "#27272a",
          timeVisible: true,
          secondsVisible: false,
        },
        crosshair: { mode: lwc.CrosshairMode.Normal },
      });
      const candle = chart.addSeries(lwc.CandlestickSeries, {
        upColor: "#34d399",
        downColor: "#f87171",
        borderUpColor: "#34d399",
        borderDownColor: "#f87171",
        wickUpColor: "#34d399",
        wickDownColor: "#f87171",
        priceFormat: { type: "price", precision: 10, minMove: 1e-10 },
      });
      const volume = chart.addSeries(lwc.HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "",
        color: "#3f3f46",
      });
      volume.priceScale().applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });
      chartRef.current = chart;
      candleSeriesRef.current = candle;
      volumeSeriesRef.current = volume;
      markersRef.current = lwc.createSeriesMarkers(candle, []);

      resizeObserver = new ResizeObserver(() => {
        if (containerRef.current && chartRef.current) {
          chartRef.current.applyOptions({
            width: containerRef.current.clientWidth,
          });
        }
      });
      resizeObserver.observe(containerRef.current);
    })();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      chartRef.current?.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      markersRef.current = null;
    };
  }, []);

  // Fetch deployer trades and render as markers on the candle series
  useEffect(() => {
    if (!highlightWallet) {
      markersRef.current?.setMarkers([]);
      return;
    }
    let cancelled = false;
    const wallet = highlightWallet.toLowerCase();

    async function loadMarkers() {
      try {
        const res = await fetch(`/api/pools/${pool}/trades`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as { trades: GtTrade[] };
        if (cancelled || !markersRef.current) return;
        const own = json.trades.filter(
          (t) => t.wallet.toLowerCase() === wallet,
        );
        const markers: SeriesMarker<Time>[] = own
          .sort((a, b) => a.blockTimestamp - b.blockTimestamp)
          .map<SeriesMarker<Time>>((t) => {
            const isBuy = t.kind === "buy";
            return {
              time: t.blockTimestamp as UTCTimestamp,
              position: isBuy ? "belowBar" : "aboveBar",
              color: isBuy ? "#34d399" : "#f87171",
              shape: isBuy ? "arrowUp" : "arrowDown",
              text: `dev ${t.kind.toUpperCase()} $${t.volumeUsd.toFixed(0)}`,
            };
          });
        markersRef.current.setMarkers(markers);
      } catch {
        // ignore
      }
    }

    loadMarkers();
    const id = setInterval(loadMarkers, 7_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pool, highlightWallet]);

  // Load + refresh candles
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function load() {
      try {
        const res = await fetch(`/api/pools/${pool}/ohlcv?tf=${tf}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { candles: Candle[] };
        if (cancelled) return;
        if (!candleSeriesRef.current || !volumeSeriesRef.current) {
          setTimeout(load, 100);
          return;
        }
        if (json.candles.length === 0) {
          setStatus("empty");
          return;
        }
        candleSeriesRef.current.setData(
          json.candles.map((c) => ({
            time: c.time as UTCTimestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          })),
        );
        volumeSeriesRef.current.setData(
          json.candles.map((c) => ({
            time: c.time as UTCTimestamp,
            value: c.volume,
            color: c.close >= c.open ? "#34d39933" : "#f8717133",
          })),
        );
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setErrMsg(err instanceof Error ? err.message : "unknown");
        setStatus("error");
      }
    }

    load();
    timer = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [pool, tf]);

  const tfButtons = useMemo(
    () =>
      TIMEFRAMES.map((t) => (
        <button
          key={t.key}
          onClick={() => setTf(t.key)}
          className={`px-2 py-1 rounded text-xs font-mono ${
            tf === t.key
              ? "bg-violet-500/20 text-violet-300"
              : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
          }`}
        >
          {t.label}
        </button>
      )),
    [tf],
  );

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
        <div className="flex gap-1">{tfButtons}</div>
        <div className="text-xs text-zinc-500">
          {status === "loading" && "loading…"}
          {status === "empty" && "no trades yet"}
          {status === "error" && `error: ${errMsg}`}
          {status === "ready" && "live"}
        </div>
      </div>
      <div ref={containerRef} className="w-full" style={{ height: 480 }} />
    </div>
  );
}
