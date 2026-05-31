import { fetchBankrLaunches, fetchDeployerLaunches } from "./bankr";
import { fetchDexPairs, pickBestPair } from "./dexscreener";
import { getPaidBankrEntries } from "./paid-watcher";
import type { BankrLaunch, EnrichedLaunch } from "./types";

export type EnrichedLaunchesResult = {
  launches: EnrichedLaunch[];
  extraPaid: EnrichedLaunch[];
};

async function enrichLaunches(
  launches: BankrLaunch[],
): Promise<EnrichedLaunch[]> {
  if (launches.length === 0) return [];
  const pairs = await fetchDexPairs(launches.map((l) => l.tokenAddress));
  const distinctDeployers = Array.from(
    new Set(launches.map((l) => l.deployer.walletAddress.toLowerCase())),
  );
  const counts = new Map<string, number>();
  await Promise.all(
    distinctDeployers.map(async (addr) => {
      try {
        const s = await fetchDeployerLaunches(addr);
        counts.set(addr, s.count);
      } catch {}
    }),
  );
  return launches.map((l) => {
    const pair = pickBestPair(l.tokenAddress, pairs);
    const pairBoost = pair?.boosts?.active ?? 0;
    return {
      ...l,
      pair,
      deployerLaunchCount: counts.get(l.deployer.walletAddress.toLowerCase()),
      dexPaid: pairBoost > 0
        ? { boosted: true, boostAmount: pairBoost, totalBoostAmount: pairBoost, hasProfile: false, orderTypes: [] }
        : undefined,
    };
  });
}

export async function getEnrichedLaunchesResult(): Promise<EnrichedLaunchesResult> {
  const launches = await fetchBankrLaunches();
  const enriched = await enrichLaunches(launches);

  // The paid watcher (src/lib/paid-watcher.ts) is the single source of truth
  // for paid signals. It polls DexScreener every 10s independently and
  // classifies Base addresses against the disk-persisted launchCache without
  // hammering Bankr. We just read its current state here — zero external
  // calls in this request path.
  const paidEntries = await getPaidBankrEntries();
  const paidByAddr = new Map(paidEntries.map((e) => [e.address, e]));

  // Overlay paid data + firstPaidAt onto launches that appear in both feeds.
  const enrichedWithFlash = enriched.map((l) => {
    const pe = paidByAddr.get(l.tokenAddress.toLowerCase());
    if (!pe) return l;
    return overlayPaid(l, pe);
  });

  // Build extraPaid for paid Bankr launches that are NOT in the latest 50
  // and were launched within the last 14 days.
  const recentSet = new Set(launches.map((l) => l.tokenAddress.toLowerCase()));
  const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - FOURTEEN_DAYS_MS;
  const extraEntries = paidEntries.filter(
    (e) =>
      !recentSet.has(e.address) &&
      e.bankr.timestamp >= cutoff &&
      // Only surface entries we have actual paid signal for right now —
      // skip ones whose boost expired AND never had a profile.
      ((e.boostAmount ?? 0) > 0 || e.hasProfile),
  );
  const extraEnriched = await enrichLaunches(extraEntries.map((e) => e.bankr));
  const extraPaid = extraEnriched.map((l) => {
    const pe = paidByAddr.get(l.tokenAddress.toLowerCase());
    return pe ? overlayPaid(l, pe) : l;
  });

  return { launches: enrichedWithFlash, extraPaid };
}

function overlayPaid(
  l: EnrichedLaunch,
  pe: { boostAmount: number; totalBoostAmount: number; hasProfile: boolean; firstPaidAt: number; lastBoostedAt?: number; lastProfileAt?: number; goplus?: import("./types").GoplusResult },
): EnrichedLaunch {
  const existing = l.dexPaid;
  const boostAmount = Math.max(existing?.boostAmount ?? 0, pe.boostAmount);
  return {
    ...l,
    dexPaid: {
      boosted: boostAmount > 0 || (existing?.boosted ?? false),
      boostAmount,
      totalBoostAmount: Math.max(
        existing?.totalBoostAmount ?? 0,
        pe.totalBoostAmount,
      ),
      hasProfile: pe.hasProfile || (existing?.hasProfile ?? false),
      orderTypes: existing?.orderTypes ?? [],
    },
    firstPaidAt: pe.firstPaidAt,
    lastBoostedAt: pe.lastBoostedAt,
    lastProfileAt: pe.lastProfileAt,
    goplus: pe.goplus,
  };
}

export async function getEnrichedLaunches(): Promise<EnrichedLaunch[]> {
  const launches = await fetchBankrLaunches();
  return enrichLaunches(launches);
}
