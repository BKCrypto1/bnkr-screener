"use client";

import { useEffect, useMemo, useState } from "react";
import type { GtTrade } from "@/lib/geckoterminal";
import { fmtAge, fmtTokenAmount, fmtUsd, shortAddr } from "@/lib/format";

export function TradesTable({
  pool,
  baseTokenAddress,
  deployerAddress,
  deployerXUsername,
  feeRecipientAddress,
  feeRecipientXUsername,
}: {
  pool: string;
  baseTokenAddress: string;
  deployerAddress?: string;
  deployerXUsername?: string;
  feeRecipientAddress?: string;
  feeRecipientXUsername?: string;
}) {
  const [trades, setTrades] = useState<GtTrade[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">(
    "loading",
  );
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/pools/${pool}/trades`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { trades: GtTrade[] };
        if (cancelled) return;
        const sorted = [...json.trades].sort(
          (a, b) => b.blockTimestamp - a.blockTimestamp,
        );
        setTrades(sorted);
        setStatus(sorted.length === 0 ? "empty" : "ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }
    load();
    const id = setInterval(load, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pool]);

  const baseAddr = baseTokenAddress.toLowerCase();
  const deployerAddr = deployerAddress?.toLowerCase();
  const feeAddr = feeRecipientAddress?.toLowerCase();
  const deployerTradeCount = useMemo(
    () =>
      deployerAddr
        ? trades.filter((t) => t.wallet.toLowerCase() === deployerAddr).length
        : 0,
    [trades, deployerAddr],
  );

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
        <div className="text-sm font-medium flex items-center gap-2">
          Trades
          {deployerTradeCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 font-mono uppercase tracking-wide">
              {deployerTradeCount} by deployer
            </span>
          )}
        </div>
        <div className="text-xs text-zinc-500">
          {status === "loading" && "loading…"}
          {status === "empty" && "no trades yet"}
          {status === "ready" && `${trades.length} recent`}
          {status === "error" && "error"}
        </div>
      </div>
      <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-zinc-900/60 sticky top-0 text-zinc-400 uppercase tracking-wide">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Age</th>
              <th className="text-left px-3 py-2 font-medium">Type</th>
              <th className="text-right px-3 py-2 font-medium">USD</th>
              <th className="text-right px-3 py-2 font-medium">Price</th>
              <th className="text-right px-3 py-2 font-medium">Tokens</th>
              <th className="text-left px-3 py-2 font-medium">Wallet</th>
              <th className="text-left px-3 py-2 font-medium">Tx</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t, idx) => {
              const isBuy = t.kind === "buy";
              const colorClass = isBuy ? "text-emerald-400" : "text-rose-400";
              const wallet = t.wallet.toLowerCase();
              const isDeployer = deployerAddr && wallet === deployerAddr;
              const isFeeRecipient = feeAddr && wallet === feeAddr;
              const tokenAmount =
                t.fromTokenAddress.toLowerCase() === baseAddr
                  ? Number(t.fromTokenAmount)
                  : Number(t.toTokenAmount);
              const priceUsd =
                t.fromTokenAddress.toLowerCase() === baseAddr
                  ? Number(t.priceFromInUsd)
                  : Number(t.priceToInUsd);
              const rowClass = isDeployer
                ? "border-t border-amber-500/20 bg-amber-500/[0.04] hover:bg-amber-500/10"
                : isFeeRecipient
                ? "border-t border-zinc-900 bg-zinc-900/30 hover:bg-zinc-900/50"
                : "border-t border-zinc-900 hover:bg-zinc-900/40";
              return (
                <tr
                  key={`${t.txHash}:${t.kind}:${t.fromTokenAmount}:${idx}`}
                  className={rowClass}
                >
                  <td
                    className="px-3 py-1.5 text-zinc-400 whitespace-nowrap"
                    suppressHydrationWarning
                  >
                    {fmtAge(t.blockTimestamp * 1000)}
                  </td>
                  <td
                    className={`px-3 py-1.5 font-medium uppercase ${colorClass}`}
                  >
                    {t.kind}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono whitespace-nowrap">
                    {fmtUsd(t.volumeUsd)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-zinc-300 whitespace-nowrap">
                    {fmtUsd(priceUsd)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-zinc-400 whitespace-nowrap">
                    {fmtTokenAmount(tokenAmount)}
                  </td>
                  <td className="px-3 py-1.5 font-mono whitespace-nowrap">
                    {isDeployer && deployerXUsername ? (
                      <a
                        href={`https://x.com/${deployerXUsername}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-amber-300 hover:text-amber-200"
                        title={t.wallet}
                      >
                        @{deployerXUsername}
                      </a>
                    ) : isFeeRecipient && feeRecipientXUsername ? (
                      <a
                        href={`https://x.com/${feeRecipientXUsername}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-zinc-200 hover:text-zinc-50"
                        title={t.wallet}
                      >
                        @{feeRecipientXUsername}
                      </a>
                    ) : (
                      <a
                        href={`https://basescan.org/address/${t.wallet}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-zinc-400 hover:text-zinc-100"
                      >
                        {shortAddr(t.wallet)}
                      </a>
                    )}
                    {isDeployer && (
                      <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-300 uppercase tracking-wide">
                        deployer
                      </span>
                    )}
                    {isFeeRecipient && !isDeployer && (
                      <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-zinc-700/60 text-zinc-300 uppercase tracking-wide">
                        fee
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 font-mono">
                    <a
                      href={`https://basescan.org/tx/${t.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-zinc-500 hover:text-zinc-100"
                    >
                      ↗
                    </a>
                  </td>
                </tr>
              );
            })}
            {trades.length === 0 && status !== "loading" && (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-12 text-center text-zinc-500"
                >
                  No trades yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
