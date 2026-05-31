import { fetchBankrLaunch, fetchBankrLaunches } from "./bankr";
import { fetchDexPairs, fetchDexPairsForToken, fetchPaidBaseSignals } from "./dexscreener";
import { K, redis } from "./redis";
import type { BankrLaunch } from "./types";

export type PaidEntry = {
  address: string;
  boostAmount: number;
  totalBoostAmount: number;
  hasProfile: boolean;
  firstPaidAt: number;
  lastSeenAt: number;
  lastBoostedAt?: number;
  lastProfileAt?: number;
  bankr?: BankrLaunch | null;
};

const PRUNE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

export function isPaidProfile(p: {
  info?: {
    header?: string;
    websites?: Array<{ url: string }>;
    socials?: Array<{ url: string }>;
  };
}): boolean {
  if (!p.info) return false;
  if (p.info.header) return true;
  if ((p.info.websites?.length ?? 0) > 0) return true;
  if ((p.info.socials?.length ?? 0) > 0) return true;
  return false;
}

function bestPairFor(
  addr: string,
  pairs: Awaited<ReturnType<typeof fetchDexPairsForToken>>,
) {
  return pairs
    .filter((p) => p.baseToken?.address?.toLowerCase() === addr)
    .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
}

/**
 * Core poll — called by /api/cron/poll-paid once per minute.
 *
 * Step 1: DexScreener global boost/profile feeds → catch brand-new payments.
 * Step 2: Check every token in the current Bankr top-50 individually.
 * Step 3: Re-check all currently known paid tokens for expiry / upgrades.
 *
 * No ZSET, no drain queue, no per-deployer backfill. We only care whether a
 * token has an active boost or a paid profile — both are visible per-token
 * via fetchDexPairsForToken (single-address, no 30-pair cap).
 */
export async function pollOnce(): Promise<PaidEntry[]> {
  const now = Date.now();
  const newEntries: PaidEntry[] = [];

  // Step 1: Global feeds — discover newly paid Base tokens.
  const signals = await fetchPaidBaseSignals().catch(() => []);
  for (const sig of signals) {
    const addr = sig.address.toLowerCase();
    const prev = await redis.hget<PaidEntry>(K.paid, addr).catch(() => null);
    let bankr = prev?.bankr;
    if (bankr === undefined) {
      bankr = await fetchBankrLaunch(addr).catch(() => null);
    }
    if (!bankr) continue;
    const entry: PaidEntry = {
      address: addr,
      boostAmount: Math.max(sig.boostAmount, prev?.boostAmount ?? 0),
      totalBoostAmount: Math.max(sig.boostAmount, prev?.totalBoostAmount ?? 0),
      hasProfile: sig.hasProfile || prev?.hasProfile === true,
      firstPaidAt: prev?.firstPaidAt ?? now,
      lastSeenAt: now,
      lastBoostedAt: sig.boostAmount > 0 ? now : prev?.lastBoostedAt,
      lastProfileAt: sig.hasProfile ? now : prev?.lastProfileAt,
      bankr,
    };
    await redis.hset(K.paid, { [addr]: entry }).catch(() => {});
    const isNewBoost = (prev?.boostAmount ?? 0) === 0 && sig.boostAmount > 0;
    const isNewProfile = !prev?.hasProfile && sig.hasProfile;
    if (!prev || isNewBoost || isNewProfile) newEntries.push(entry);
  }

  // Step 2: Check every token in the current Bankr top-50.
  // Batch fetch — 2 DexScreener calls for 50 tokens, shares Vercel data cache
  // with the main page render so often costs zero actual API calls.
  const launches = await fetchBankrLaunches().catch(() => []);
  const top50Pairs = await fetchDexPairs(launches.map((l) => l.tokenAddress)).catch(() => []);
  for (const launch of launches) {
    const addr = launch.tokenAddress.toLowerCase();
    const best = bestPairFor(addr, top50Pairs);
    if (!best) continue;
    const active = best.boosts?.active ?? 0;
    const hasProfile = isPaidProfile(best);
    if (!active && !hasProfile) continue;
    const alreadyKnown = await redis.hget<PaidEntry>(K.paid, addr).catch(() => null);
    const entry: PaidEntry = {
      address: addr,
      boostAmount: active,
      totalBoostAmount: active,
      hasProfile,
      firstPaidAt: now,
      lastSeenAt: now,
      lastBoostedAt: active > 0 ? now : undefined,
      lastProfileAt: hasProfile ? now : undefined,
      bankr: launch,
    };
    await redis.hset(K.paid, { [addr]: entry }).catch(() => {});
    const isNewBoost = (alreadyKnown?.boostAmount ?? 0) === 0 && active > 0;
    const isNewProfile = !alreadyKnown?.hasProfile && hasProfile;
    if (!alreadyKnown || isNewBoost || isNewProfile) newEntries.push(entry);
  }

  // Step 3: Re-check all currently known paid tokens — runs every 5 minutes.
  // Reduces hgetall + per-token hset ops from 1440/day to ~288/day.
  const cronMinute = Math.floor(now / 60_000);
  if (cronMinute % 5 !== 0) return newEntries;

  const allPaid =
    (await redis.hgetall<Record<string, PaidEntry>>(K.paid).catch(() => null)) ??
    {};
  const toDelete: string[] = [];
  for (const [addr, entry] of Object.entries(allPaid)) {
    if (!entry.bankr || now - entry.lastSeenAt > PRUNE_AFTER_MS) {
      toDelete.push(addr);
      continue;
    }
    const pairs = await fetchDexPairsForToken(addr).catch(() => []);
    const best = bestPairFor(addr, pairs);
    if (!best) continue;
    const newBoost = best.boosts?.active ?? 0;
    const newProfile = isPaidProfile(best);
    const isNewBoost = entry.boostAmount === 0 && newBoost > 0;
    const isNewProfile = !entry.hasProfile && newProfile;
    const updated: PaidEntry = {
      ...entry,
      boostAmount: newBoost,
      totalBoostAmount: Math.max(entry.totalBoostAmount, newBoost),
      hasProfile: newProfile,
      lastSeenAt: now,
      lastBoostedAt: newBoost > 0 ? now : entry.lastBoostedAt,
      lastProfileAt: newProfile ? now : entry.lastProfileAt,
    };
    await redis.hset(K.paid, { [addr]: updated }).catch(() => {});
    if (isNewBoost || isNewProfile) newEntries.push(updated);
  }
  if (toDelete.length > 0) {
    await redis
      .hdel(K.paid, ...(toDelete as [string, ...string[]]))
      .catch(() => {});
  }
  return newEntries;
}

/** All currently tracked paid Bankr launches. Called on every page render. */
export async function getPaidBankrEntries(): Promise<
  Array<PaidEntry & { bankr: BankrLaunch }>
> {
  const all =
    (await redis
      .hgetall<Record<string, PaidEntry>>(K.paid)
      .catch(() => null)) ?? {};
  const out: Array<PaidEntry & { bankr: BankrLaunch }> = [];
  for (const entry of Object.values(all)) {
    if (entry.bankr) out.push(entry as PaidEntry & { bankr: BankrLaunch });
  }
  return out;
}
