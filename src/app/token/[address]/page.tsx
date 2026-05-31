import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchBankrLaunch, fetchDeployerLaunches } from "@/lib/bankr";
import {
  fetchDexPairs,
  fetchDexPaidStatus,
  pickBestPair,
} from "@/lib/dexscreener";
import {
  boostColorClass,
  boostTierFor,
  estimateBoostSpend,
} from "@/lib/dex-boost";
import { fetchTopPoolForToken } from "@/lib/geckoterminal";
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

  const [pairs, deployerSummary, dexPaid] = await Promise.all([
    fetchDexPairs([launch.tokenAddress]),
    fetchDeployerLaunches(launch.deployer.walletAddress).catch(() => null),
    fetchDexPaidStatus(launch.tokenAddress).catch(() => null),
  ]);
  const pair = pickBestPair(launch.tokenAddress, pairs);
  const pool =
    pair?.pairAddress ?? (await fetchTopPoolForToken(launch.tokenAddress));
  const img = ipfsToHttp(launch.imageUri);
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
        <KV label="Token address" value={launch.tokenAddress} mono />
        <KV
          label="Deployer"
          value={
            launch.deployer.xUsername
              ? `@${launch.deployer.xUsername} (${shortAddr(launch.deployer.walletAddress)})`
              : launch.deployer.walletAddress
          }
          mono={!launch.deployer.xUsername}
          extra={
            deployerSummary
              ? `${deployerSummary.count}${deployerSummary.truncated ? "+" : ""} lifetime launches`
              : undefined
          }
        />
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
  extra,
}: {
  label: string;
  value: string;
  mono?: boolean;
  extra?: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 break-all ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </div>
      {extra && (
        <div className="mt-1 text-xs text-amber-400/80">{extra}</div>
      )}
    </div>
  );
}
