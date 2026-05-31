import { fetchBankrLaunch, fetchBankrLaunches } from "./bankr";
import { fetchDexPairsForToken, fetchPaidBaseSignals } from "./dexscreener";
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

const PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

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
export async function pollOnce(): Promise<void> {
  const now = Date.now();

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
    await redis
      .hset(K.paid, {
        [addr]: {
          address: addr,
          boostAmount: Math.max(sig.boostAmount, prev?.boostAmount ?? 0),
          totalBoostAmount: Math.max(
            sig.boostAmount,
            prev?.totalBoostAmount ?? 0,
          ),
          hasProfile: sig.hasProfile || prev?.hasProfile === true,
          firstPaidAt: prev?.firstPaidAt ?? now,
          lastSeenAt: now,
          lastBoostedAt: sig.boostAmount > 0 ? now : prev?.lastBoostedAt,
          lastProfileAt: sig.hasProfile ? now : prev?.lastProfileAt,
          bankr,
        } satisfies PaidEntry,
      })
      .catch(() => {});
  }

  // Step 2: Check every token in the current Bankr top-50 individually.
  // fetchDexPairsForToken avoids the 30-pair cap that batched calls suffer from.
  const launches = await fetchBankrLaunches().catch(() => []);
  for (const launch of launches) {
    const addr = launch.tokenAddress.toLowerCase();
    const pairs = await fetchDexPairsForToken(addr).catch(() => []);
    const best = bestPairFor(addr, pairs);
    if (!best) continue;
    const active = best.boosts?.active ?? 0;
    const hasProfile = isPaidProfile(best);
    if (!active && !hasProfile) continue;
    const prev = await redis.hget<PaidEntry>(K.paid, addr).catch(() => null);
    await redis
      .hset(K.paid, {
        [addr]: {
          address: addr,
          boostAmount: active,
          totalBoostAmount: Math.max(prev?.totalBoostAmount ?? 0, active),
          hasProfile,
          firstPaidAt: prev?.firstPaidAt ?? now,
          lastSeenAt: now,
          lastBoostedAt: active > 0 ? now : prev?.lastBoostedAt,
          lastProfileAt: hasProfile ? now : prev?.lastProfileAt,
          bankr: launch,
        } satisfies PaidEntry,
      })
      .catch(() => {});
  }

  // Step 3: Re-check all currently known paid tokens.
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
    await redis
      .hset(K.paid, {
        [addr]: {
          ...entry,
          boostAmount: best.boosts?.active ?? 0,
          totalBoostAmount: Math.max(
            entry.totalBoostAmount,
            best.boosts?.active ?? 0,
          ),
          hasProfile: isPaidProfile(best),
          lastSeenAt: now,
          lastBoostedAt: (best.boosts?.active ?? 0) > 0 ? now : entry.lastBoostedAt,
          lastProfileAt: isPaidProfile(best) ? now : entry.lastProfileAt,
        } satisfies PaidEntry,
      })
      .catch(() => {});
  }
  if (toDelete.length > 0) {
    await redis
      .hdel(K.paid, ...(toDelete as [string, ...string[]]))
      .catch(() => {});
  }
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
