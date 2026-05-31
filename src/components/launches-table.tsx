"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { EnrichedLaunch } from "@/lib/types";
import { fmtAge, fmtPct, fmtPrice, fmtUsd, ipfsToHttp } from "@/lib/format";
import {
  boostColorClass,
  boostTierFor,
  estimateBoostSpend,
} from "@/lib/dex-boost";

type SortKey =
  | "age"
  | "name"
  | "price"
  | "change24"
  | "volume24"
  | "liquidity"
  | "marketCap";

type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "age", label: "Age", align: "left" },
  { key: "name", label: "Token", align: "left" },
  { key: "price", label: "Price", align: "right" },
  { key: "change24", label: "24h %", align: "right" },
  { key: "volume24", label: "Vol 24h", align: "right" },
  { key: "liquidity", label: "Liquidity", align: "right" },
  { key: "marketCap", label: "Market cap", align: "right" },
];

function sortVal(l: EnrichedLaunch, key: SortKey): number | string {
  switch (key) {
    case "age":
      return -l.timestamp;
    case "name":
      return l.tokenName.toLowerCase();
    case "price":
      return Number(l.pair?.priceUsd ?? 0);
    case "change24":
      return l.pair?.priceChange?.h24 ?? 0;
    case "volume24":
      return l.pair?.volume?.h24 ?? 0;
    case "liquidity":
      return l.pair?.liquidity?.usd ?? 0;
    case "marketCap":
      return l.pair?.marketCap ?? l.pair?.fdv ?? 0;
  }
}

export function LaunchesTable({
  initial,
  initialExtraPaid,
}: {
  initial: EnrichedLaunch[];
  initialExtraPaid?: EnrichedLaunch[];
}) {
  const [data, setData] = useState<EnrichedLaunch[]>(initial);
  const [extraPaid, setExtraPaid] = useState<EnrichedLaunch[]>(
    initialExtraPaid ?? [],
  );
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("age");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [tradedOnly, setTradedOnly] = useState(true);
  const [paidOnly, setPaidOnly] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    const ageTimer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(ageTimer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        setRefreshing(true);
        const res = await fetch("/api/launches", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as {
          launches: EnrichedLaunch[];
          extraPaid?: EnrichedLaunch[];
          fetchedAt: number;
        };
        if (!cancelled) {
          setData(json.launches);
          setExtraPaid(json.extraPaid ?? []);
          setLastUpdated(json.fetchedAt);
        }
      } catch {
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    }
    const id = setInterval(refresh, 3_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // When "Paid DEX" filter is on, expand the universe to include older
    // Bankr launches that have paid (sourced via DexScreener boosts/profiles).
    const fullSet = paidOnly ? [...data, ...extraPaid] : data;
    let base = tradedOnly
      ? fullSet.filter((l) => (l.pair?.volume?.h24 ?? 0) > 0)
      : fullSet;
    if (paidOnly) {
      base = base.filter(
        (l) => l.dexPaid?.boosted || l.dexPaid?.hasProfile,
      );
    }
    if (q) {
      base = base.filter((l) => {
        return (
          l.tokenName.toLowerCase().includes(q) ||
          l.tokenSymbol.toLowerCase().includes(q) ||
          l.tokenAddress.toLowerCase().includes(q) ||
          l.deployer.walletAddress.toLowerCase().includes(q) ||
          l.deployer.xUsername?.toLowerCase().includes(q)
        );
      });
    }
    const sorted = [...base].sort((a, b) => {
      const av = sortVal(a, sortKey);
      const bv = sortVal(b, sortKey);
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const an = Number(av);
      const bn = Number(bv);
      return sortDir === "asc" ? an - bn : bn - an;
    });
    return sorted;
  }, [data, extraPaid, query, sortKey, sortDir, tradedOnly, paidOnly]);

  const hiddenCount = useMemo(
    () =>
      tradedOnly
        ? data.filter((l) => (l.pair?.volume?.h24 ?? 0) === 0).length
        : 0,
    [data, tradedOnly],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, EnrichedLaunch[]>();
    for (const l of filtered) {
      const key = `${l.deployer.walletAddress.toLowerCase()}::${l.tokenName.trim().toLowerCase()}::${l.tokenSymbol.trim().toLowerCase()}`;
      const arr = map.get(key);
      if (arr) arr.push(l);
      else map.set(key, [l]);
    }
    const out: Array<{ primary: EnrichedLaunch; attempts: number }> = [];
    for (const members of map.values()) {
      if (members.length >= 3) {
        const primary = [...members].sort((a, b) => {
          const av = a.pair?.volume?.h24 ?? 0;
          const bv = b.pair?.volume?.h24 ?? 0;
          if (bv !== av) return bv - av;
          return b.timestamp - a.timestamp;
        })[0];
        out.push({ primary, attempts: members.length });
      } else {
        for (const m of members) out.push({ primary: m, attempts: 1 });
      }
    }
    // Re-apply current sort order to the collapsed rows
    return out.sort((a, b) => {
      const av = sortVal(a.primary, sortKey);
      const bv = sortVal(b.primary, sortKey);
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc"
        ? Number(av) - Number(bv)
        : Number(bv) - Number(av);
    });
  }, [filtered, sortKey, sortDir]);

  const paidStats = useMemo(() => {
    const all = new Map<string, EnrichedLaunch>();
    for (const l of [...data, ...extraPaid]) {
      if (l.dexPaid?.boosted || l.dexPaid?.hasProfile) {
        all.set(l.tokenAddress.toLowerCase(), l);
      }
    }
    let boosted = 0;
    let profile = 0;
    for (const l of all.values()) {
      if (l.dexPaid?.boosted) boosted++;
      if (l.dexPaid?.hasProfile) profile++;
    }
    return { count: all.size, boosted, profile };
  }, [data, extraPaid]);

  function onSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name, symbol, address, or deployer…"
          className="flex-1 min-w-[240px] rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
        <button
          onClick={() => setTradedOnly((v) => !v)}
          className={`text-xs px-3 py-2 rounded-md border transition-colors tabular-nums ${
            tradedOnly
              ? "border-violet-500/40 bg-violet-500/10 text-violet-200"
              : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-100"
          }`}
          title={
            tradedOnly && hiddenCount > 0
              ? `${hiddenCount} tokens hidden (no 24h volume)`
              : "Only show tokens with 24h trading volume"
          }
        >
          Traded only
        </button>
        <button
          onClick={() => setPaidOnly((v) => !v)}
          className={`text-xs px-3 py-2 rounded-md border transition-colors tabular-nums ${
            paidOnly
              ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-200"
              : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-100"
          }`}
          title={`${paidStats.count} paid (${paidStats.boosted} boost · ${paidStats.profile} profile)`}
        >
          {paidStatsIcons(paidStats)} Paid DEX
          {paidStats.count > 0 && (
            <span className="ml-1.5 text-zinc-500">{paidStats.count}</span>
          )}
        </button>
        <div className="text-xs text-zinc-500 flex items-center gap-2 tabular-nums">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full transition-colors ${
              refreshing ? "bg-violet-400" : "bg-emerald-500/70"
            }`}
            aria-label={refreshing ? "refreshing" : "live"}
            title={refreshing ? "refreshing…" : "live"}
          />
          <span suppressHydrationWarning>{fmtAge(lastUpdated)}</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900/60 text-xs uppercase tracking-wide text-zinc-400">
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={`px-3 py-2 font-medium ${
                    c.align === "right" ? "text-right" : "text-left"
                  } cursor-pointer select-none hover:text-zinc-100`}
                  onClick={() => onSort(c.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {sortKey === c.key && (
                      <span className="text-violet-400">
                        {sortDir === "asc" ? "▲" : "▼"}
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grouped.map((g) => (
              <Row
                key={g.primary.activityId}
                launch={g.primary}
                attempts={g.attempts}
              />
            ))}
            {grouped.length === 0 && (
              <tr>
                <td
                  colSpan={COLUMNS.length}
                  className="px-3 py-12 text-center text-zinc-500"
                >
                  No launches match your filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function paidStatsIcons(s: { boosted: number; profile: number }): string {
  if (s.boosted > 0 && s.profile > 0) return "⚡💎";
  if (s.boosted > 0) return "⚡";
  if (s.profile > 0) return "💎";
  return "⚡💎"; // empty state: show both to convey what the filter covers
}

function deployerCountClass(n: number): string {
  if (n >= 20) return "text-rose-400";
  if (n >= 6) return "text-amber-400";
  return "text-zinc-400";
}

function fmtAgo(ts: number | undefined): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function boostTitle(p: NonNullable<EnrichedLaunch["dexPaid"]>, launch: EnrichedLaunch): string {
  if (!p.boosted) return "";
  const tier = boostTierFor(p.boostAmount);
  const lines: string[] = [];
  if (tier) {
    lines.push(`Boost ${tier.multiplier}x · $${tier.usdCost} · ${tier.durationHours}h`);
  } else {
    lines.push(`Boost ${p.boostAmount}x`);
  }
  if (p.totalBoostAmount > p.boostAmount) {
    const lifetime = estimateBoostSpend(p.totalBoostAmount);
    lines.push(`Lifetime: ${p.totalBoostAmount}x (~$${lifetime})`);
  }
  if (launch.lastBoostedAt) lines.push(`Last boosted: ${fmtAgo(launch.lastBoostedAt)}`);
  if (launch.firstPaidAt) lines.push(`First paid: ${fmtAgo(launch.firstPaidAt)}`);
  return lines.join(" · ");
}

function Row({
  launch,
  attempts = 1,
}: {
  launch: EnrichedLaunch;
  attempts?: number;
}) {
  const p = launch.pair;
  const change = p?.priceChange?.h24;
  const changeClass =
    change === undefined
      ? "text-zinc-500"
      : change >= 0
      ? "text-emerald-400"
      : "text-rose-400";
  const img = ipfsToHttp(launch.imageUri);
  const isFreshPaid =
    launch.firstPaidAt !== undefined &&
    Date.now() - launch.firstPaidAt < 60_000;
  return (
    <tr
      className={`border-t border-zinc-900 hover:bg-zinc-900/40 ${
        isFreshPaid ? "paid-flash" : ""
      }`}
    >
      <td
        className="px-3 py-2 text-zinc-400 whitespace-nowrap tabular-nums w-12"
        suppressHydrationWarning
      >
        {fmtAge(launch.timestamp)}
      </td>
      <td className="px-3 py-2">
        <Link
          href={`/token/${launch.tokenAddress}`}
          className="flex items-center gap-2 group"
        >
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={img}
              alt=""
              className="h-7 w-7 rounded-full bg-zinc-800 object-cover"
              loading="lazy"
            />
          ) : (
            <div className="h-7 w-7 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] text-zinc-500">
              {launch.tokenSymbol.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="flex flex-col">
            <span className="font-medium group-hover:text-violet-300 inline-flex items-center gap-1.5">
              {launch.tokenName}
              {attempts > 1 && (
                <span
                  className="text-[10px] px-1 py-0.5 rounded bg-rose-500/15 text-rose-300 font-mono uppercase tracking-wide"
                  title={`${attempts} launches of "${launch.tokenName}" by this deployer — showing the highest-volume one`}
                >
                  {attempts}× attempts
                </span>
              )}
            </span>
            <span className="text-xs text-zinc-500 inline-flex items-center gap-1.5">
              <span>{launch.tokenSymbol}</span>
              {launch.deployer.xUsername && (
                <span>· @{launch.deployer.xUsername}</span>
              )}
              {launch.deployerLaunchCount !== undefined &&
                launch.deployerLaunchCount > 1 && (
                  <span
                    className={`inline-flex items-center gap-0.5 font-mono ${deployerCountClass(launch.deployerLaunchCount)}`}
                    title={`${launch.deployerLaunchCount} lifetime launches by this deployer`}
                  >
                    👑 {launch.deployerLaunchCount}
                  </span>
                )}
              {launch.dexPaid?.boosted && launch.dexPaid.boostAmount > 0 && (
                <span
                  className={`inline-flex items-center gap-0.5 font-mono ${boostColorClass(launch.dexPaid.boostAmount)}`}
                  title={boostTitle(launch.dexPaid, launch)}
                >
                  ⚡ {launch.dexPaid.boostAmount}x
                </span>
              )}
              {launch.dexPaid?.hasProfile && (
                <span
                  className="inline-flex items-center font-mono text-cyan-300"
                  title={`DexScreener profile claim (paid one-time)${launch.lastProfileAt ? ` · Last seen: ${fmtAgo(launch.lastProfileAt)}` : ""}${launch.firstPaidAt ? ` · First paid: ${fmtAgo(launch.firstPaidAt)}` : ""}`}
                >
                  💎
                </span>
              )}
            </span>
          </div>
        </Link>
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">
        {fmtPrice(p?.priceUsd)}
      </td>
      <td
        className={`px-3 py-2 text-right font-mono tabular-nums ${changeClass}`}
      >
        {fmtPct(change)}
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-300">
        {fmtUsd(p?.volume?.h24)}
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-300">
        {fmtUsd(p?.liquidity?.usd)}
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-300">
        {fmtUsd(p?.marketCap ?? p?.fdv)}
      </td>
    </tr>
  );
}
