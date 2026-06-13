import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchBankrLaunch, fetchDeployerLaunches } from "@/lib/bankr";
import {
  fetchDexPairs,
  fetchDexPaidStatus,
  pickBestPair,
} from "@/lib/dexscreener";
import { redis, K } from "@/lib/redis";
import type { PaidEntry } from "@/lib/paid-watcher";
import type { GoplusResult } from "@/lib/types";
import {
  boostColorClass,
  boostTierFor,
  estimateBoostSpend,
} from "@/lib/dex-boost";
import { fetchTopPoolForToken } from "@/lib/geckoterminal";
import { CopyButton } from "@/components/copy-button";
import { PriceChart } from "@/components/price-chart";
import { TradesTable } from "@/components/trades-table";
import {
  fmtAge,
  fmtPct,
  fmtPrice,
  fmtUsd,
  ipfsToHttp,
  shortAddr,
} from "@/lib/format";

export const revalidate = 10;

type Params = { address: string };

export default async function TokenPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { address } = await params;
  const launch = await fetchBankrLaunch(address);
  if (!launch) notFound();

  const [pairs, deployerSummary, dexPaid, paidEntry] = await Promise.all([
    fetchDexPairs([launch.tokenAddress]),
    fetchDeployerLaunches(launch.deployer.walletAddress).catch(() => null),
    fetchDexPaidStatus(launch.tokenAddress).catch(() => null),
    redis.hget<PaidEntry>(K.paid, launch.tokenAddress.toLowerCase()).catch(() => null),
  ]);
  const pair = pickBestPair(launch.tokenAddress, pairs);
  const pool =
    pair?.pairAddress ?? (await fetchTopPoolForToken(launch.tokenAddress));
  const img = ipfsToHttp(launch.imageUri);
  const fee = launch.feeRecipient;
  const feeSameAsDeployer =
    !!fee && fee.walletAddress.toLowerCase() === launch.deployer.walletAddress.toLowerCase();
  const change = pair?.priceChange?.h24;
  const changeClass =
    change === undefined
      ? "text-zinc-500"
      : change >= 0
      ? "text-emerald-400"
      : "text-rose-400";

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 flex flex-col gap-6">
      <Link
        href="/"
        className="text-sm text-zinc-400 hover:text-zinc-100 w-fit"
      >
        ← back to launches
      </Link>

      <div className="flex items-start gap-4 flex-wrap">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img}
            alt=""
            className="h-16 w-16 rounded-full bg-zinc-800 object-cover"
          />
        ) : (
          <div className="h-16 w-16 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-500">
            {launch.tokenSymbol.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-[220px]">
          <h1 className="text-2xl font-semibold flex items-center gap-2 flex-wrap">
            {launch.tokenName}
            {dexPaid?.boosted && dexPaid.boostAmount > 0 && (
              <BoostBadge
                multiplier={dexPaid.boostAmount}
                totalMultiplier={dexPaid.totalBoostAmount}
              />
            )}
            {dexPaid?.hasProfile && (
              <span
                className="text-xs px-2 py-1 rounded bg-cyan-500/15 text-cyan-300 font-mono inline-flex items-center gap-1"
                title="DexScreener profile claim (paid one-time)"
              >
                💎 Profile
              </span>
            )}
          </h1>
          <p className="text-sm text-zinc-400">
            {launch.tokenSymbol} ·{" "}
            <span className="font-mono">{shortAddr(launch.tokenAddress)}</span>{" "}
            · launched{" "}
            <span suppressHydrationWarning>{fmtAge(launch.timestamp)}</span> ago
            {paidEntry?.firstPaidAt && (
              <> · first paid <span suppressHydrationWarning>{fmtAge(paidEntry.firstPaidAt)}</span> ago</>
            )}
            {paidEntry && paidEntry.totalBoostAmount > 0 && (
              <> · boosted {paidEntry.totalBoostAmount}x (~${estimateBoostSpend(paidEntry.totalBoostAmount)})</>
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-400">
            {launch.tweetUrl && (
              <a
                href={launch.tweetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-zinc-100"
              >
                X / Twitter ↗
              </a>
            )}
            {launch.websiteUrl && (
              <a
                href={launch.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-zinc-100"
              >
                Website ↗
              </a>
            )}
            <a
              href={`https://basescan.org/token/${launch.tokenAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-zinc-100"
            >
              Basescan ↗
            </a>
            <a
              href={`https://bankr.bot/launches/${launch.tokenAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-zinc-100"
            >
              Bankr ↗
            </a>
            {pair?.url && (
              <a
                href={pair.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-zinc-100"
              >
                DexScreener ↗
              </a>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-mono">{fmtPrice(pair?.priceUsd)}</div>
          <div className={`text-sm font-mono ${changeClass}`}>
            {fmtPct(change)} 24h
          </div>
        </div>
      </div>

      {paidEntry?.goplus?.isInDex && (
        <HolderConcentration goplus={paidEntry.goplus} />
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Liquidity" value={fmtUsd(pair?.liquidity?.usd)} />
        <Stat label="Volume 24h" value={fmtUsd(pair?.volume?.h24)} />
        <Stat label="Market cap" value={fmtUsd(pair?.marketCap ?? pair?.fdv)} />
        <Stat
          label="Txns 24h"
          value={
            pair?.txns?.h24
              ? `${pair.txns.h24.buys + pair.txns.h24.sells}`
              : "—"
          }
        />
      </div>

      {pool ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-2">
            <PriceChart
              pool={pool}
              highlightWallet={launch.deployer.walletAddress}
            />
          </div>
          <div className="lg:col-span-1">
            <TradesTable
              pool={pool}
              baseTokenAddress={launch.tokenAddress}
              deployerAddress={launch.deployer.walletAddress}
              deployerXUsername={launch.deployer.xUsername}
              feeRecipientAddress={launch.feeRecipient?.walletAddress}
              feeRecipientXUsername={launch.feeRecipient?.xUsername}
            />
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-12 text-center text-zinc-500 text-sm">
          No trading pool found yet. The token may be too new or have no
          liquidity.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <KV
          label="Deployer"
          value={
            launch.deployer.xUsername
              ? `@${launch.deployer.xUsername} (${shortAddr(launch.deployer.walletAddress)})`
              : launch.deployer.walletAddress
          }
          mono={!launch.deployer.xUsername}
          href={launch.deployer.xUsername ? `https://x.com/${launch.deployer.xUsername}` : `https://basescan.org/address/${launch.deployer.walletAddress}`}
          extra={
            deployerSummary
              ? `${deployerSummary.count}${deployerSummary.truncated ? "+" : ""} lifetime launches`
              : undefined
          }
          extraHref={`/deployer/${launch.deployer.walletAddress}`}
        />
        <KV
          label="Fee recipient"
          value={
            fee
              ? fee.xUsername
                ? `@${fee.xUsername} (${shortAddr(fee.walletAddress)})`
                : fee.walletAddress
              : "Not specified"
          }
          mono={!!fee && !fee.xUsername}
          href={
            fee
              ? fee.xUsername
                ? `https://x.com/${fee.xUsername}`
                : `https://basescan.org/address/${fee.walletAddress}`
              : undefined
          }
          extra={feeSameAsDeployer ? "same as deployer" : undefined}
        />
        <KV label="Token address" value={launch.tokenAddress} mono copyValue={launch.tokenAddress} />
        <KV label="Launch type" value={launch.launchType} />
        <KV label="Chain" value={launch.chain} />
      </div>
    </div>
  );
}

function BoostBadge({
  multiplier,
  totalMultiplier,
}: {
  multiplier: number;
  totalMultiplier: number;
}) {
  const tier = boostTierFor(multiplier);
  const lifetimeUsd = estimateBoostSpend(totalMultiplier);
  const subline =
    totalMultiplier > multiplier
      ? `lifetime ${totalMultiplier}x · ~$${lifetimeUsd}`
      : tier
      ? `$${tier.usdCost} · ${tier.durationHours}h`
      : "";
  return (
    <span
      className={`text-xs px-2 py-1 rounded bg-yellow-500/15 font-mono inline-flex items-center gap-1 ${boostColorClass(multiplier)}`}
      title={
        tier
          ? `Boost ${tier.multiplier}x · $${tier.usdCost} · ${tier.durationHours}h${
              totalMultiplier > multiplier
                ? ` · lifetime ${totalMultiplier}x (~$${lifetimeUsd})`
                : ""
            }`
          : `Boost ${multiplier}x`
      }
    >
      ⚡ {multiplier}x
      {subline && (
        <span className="text-zinc-400 font-normal">{subline}</span>
      )}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 font-mono text-lg">{value}</div>
    </div>
  );
}

function KV({
  label,
  value,
  mono,
  href,
  extra,
  extraHref,
  copyValue,
}: {
  label: string;
  value: string;
  mono?: boolean;
  href?: string;
  extra?: string;
  extraHref?: string;
  copyValue?: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 flex items-center gap-2 ${mono ? "font-mono text-xs" : ""}`}>
        <span className="break-all">
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="hover:text-zinc-100 underline underline-offset-2">
              {value}
            </a>
          ) : value}
        </span>
        {copyValue && <CopyButton value={copyValue} />}
      </div>
      {extra && (
        <div className="mt-1 text-xs text-amber-400/80">
          {extraHref ? (
            <Link href={extraHref} className="hover:text-amber-300 underline underline-offset-2">
              {extra}
            </Link>
          ) : extra}
        </div>
      )}
    </div>
  );
}

function HolderConcentration({ goplus }: { goplus: GoplusResult }) {
  const { whaleCount, largeCount, mediumCount, topHolders } = goplus;
  const riskLabel = whaleCount > 0 ? "High Risk" : largeCount > 0 ? "Watch" : "Healthy";
  const riskColor = whaleCount > 0 ? "text-rose-400" : largeCount > 0 ? "text-amber-400" : "text-emerald-400";
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase tracking-wide text-zinc-500">Holder Concentration</div>
        <span className={`text-xs font-mono ${riskColor}`}>{riskLabel}</span>
      </div>
      <div className="flex gap-4 text-xs mb-3">
        <div className="flex flex-col items-center gap-0.5">
          <span className={`font-mono text-base font-semibold ${whaleCount > 0 ? "text-rose-400" : "text-zinc-600"}`}>{whaleCount}</span>
          <span className="text-zinc-500">&gt;5%</span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <span className={`font-mono text-base font-semibold ${largeCount > 0 ? "text-amber-400" : "text-zinc-600"}`}>{largeCount}</span>
          <span className="text-zinc-500">3–5%</span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <span className={`font-mono text-base font-semibold ${mediumCount > 0 ? "text-yellow-500" : "text-zinc-600"}`}>{mediumCount}</span>
          <span className="text-zinc-500">1–3%</span>
        </div>
      </div>
      {topHolders.length > 0 && (
        <div className="flex flex-col gap-1">
          {topHolders.slice(0, 5).map((h) => {
            const pct = h.percent * 100;
            const color = pct > 5 ? "bg-rose-500" : pct >= 3 ? "bg-amber-500" : "bg-yellow-600";
            return (
              <div key={h.address} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-zinc-400 w-28 shrink-0">
                  {h.address.slice(0, 6)}…{h.address.slice(-4)}
                </span>
                <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct * 4, 100)}%` }} />
                </div>
                <span className={`font-mono w-10 text-right tabular-nums ${pct > 5 ? "text-rose-400" : pct >= 3 ? "text-amber-400" : "text-zinc-400"}`}>
                  {pct.toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
