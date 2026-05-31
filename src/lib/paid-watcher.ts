import {
  backfillDeployerHistory,
  fetchBankrLaunch,
  fetchBankrLaunches,
  getRecentLaunchAddresses,
  pruneOldLaunches,
} from "./bankr";
import {
  fetchDexPairs,
  fetchDexPairsForToken,
  fetchPaidBaseSignals,
} from "./dexscreener";
import { K, redis } from "./redis";
import type { BankrLaunch } from "./types";

export type PaidEntry = {
  address: string;
  boostAmount: number;
  totalBoostAmount: number;
  hasProfile: boolean;
  firstPaidAt: number;
  lastSeenAt: number;
  bankr?: BankrLaunch | null;
};

const MAX_DRAIN_PER_TICK = 200;
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

/**
 * Core poll logic — called by the /api/cron/poll-paid route once per minute.
 *
 * Three steps:
 *  1. Pull DexScreener global boost/profile feeds to catch brand-new payments.
 *  2. Re-check each currently-known paid address for expiry / upgrades.
 *  3. Drain addresses we haven't checked yet (backfill from launchIndex).
 */
export async function pollOnce(): Promise<void> {
  const now = Date.now();

  // (1) Global feeds — discovers new paid addresses before they enter our set.
  const signals = await fetchPaidBaseSignals().catch(() => []);
  for (const sig of signals) {
    const addr = sig.address.toLowerCase();
    const prev = await redis.hget<PaidEntry>(K.paid, addr);
    let bankr = prev?.bankr;
    if (bankr === undefined) {
      bankr = await fetchBankrLaunch(addr).catch(() => null);
    }
    if (!bankr) continue;
    await redis.hset(K.paid, {
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
        bankr,
      } satisfies PaidEntry,
    });
  }

  // (2) Re-check currently known paid addresses individually.
  // fetchDexPairsForToken avoids the 30-pair cap of batched calls.
  const allPaid = (await redis.hgetall<Record<string, PaidEntry>>(K.paid)) ?? {};
  const knownPaidAddrs = Object.entries(allPaid)
    .filter(([, e]) => (e.boostAmount ?? 0) > 0 || e.hasProfile)
    .map(([addr]) => addr);

  for (const addr of knownPaidAddrs) {
    const pairs = await fetchDexPairsForToken(addr).catch(() => []);
    const best = pairs
      .filter((p) => p.baseToken?.address?.toLowerCase() === addr)
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    if (!best) continue;
    const prev = allPaid[addr];
    if (!prev?.bankr) continue;
    await redis.hset(K.paid, {
      [addr]: {
        ...prev,
        boostAmount: best.boosts?.active ?? 0,
        totalBoostAmount: Math.max(
          prev.totalBoostAmount,
          best.boosts?.active ?? 0,
        ),
        hasProfile: isPaidProfile(best),
        lastSeenAt: now,
      } satisfies PaidEntry,
    });
  }

  // (3) Drain unchecked addresses from the 14-day launch index.
  const [allKnown, checkedMembers] = await Promise.all([
    getRecentLaunchAddresses(),
    redis.smembers(K.paidChecked),
  ]);
  const checked = new Set(checkedMembers as string[]);
  const unchecked = allKnown.filter((a) => !checked.has(a));

  if (unchecked.length > 0) {
    const batch = unchecked.slice(0, MAX_DRAIN_PER_TICK);
    const pairs = await fetchDexPairs(batch).catch(() => []);
    type Sig = { boost: number; profile: boolean };
    const sigByToken = new Map<string, Sig>();
    for (const p of pairs) {
      const baseAddr = p.baseToken?.address?.toLowerCase();
      if (!baseAddr) continue;
      const active = p.boosts?.active ?? 0;
      const hasProfile = isPaidProfile(p);
      if (!active && !hasProfile) continue;
      const prev = sigByToken.get(baseAddr) ?? { boost: 0, profile: false };
      sigByToken.set(baseAddr, {
        boost: Math.max(prev.boost, active),
        profile: prev.profile || hasProfile,
      });
    }
    for (const [addr, sig] of sigByToken) {
      const prev = await redis.hget<PaidEntry>(K.paid, addr);
      let bankr = prev?.bankr;
      if (bankr === undefined) {
        bankr = await fetchBankrLaunch(addr).catch(() => null);
      }
      if (!bankr) continue;
      await redis.hset(K.paid, {
        [addr]: {
          address: addr,
          boostAmount: sig.boost,
          totalBoostAmount: Math.max(prev?.totalBoostAmount ?? 0, sig.boost),
          hasProfile: sig.profile || prev?.hasProfile === true,
          firstPaidAt: prev?.firstPaidAt ?? now,
          lastSeenAt: now,
          bankr,
        } satisfies PaidEntry,
      });
    }
    if (batch.length > 0) {
      await redis.sadd(K.paidChecked, ...(batch as [string, ...string[]]));
    }
  }

  // Prune paid entries not seen in 7 days or missing a bankr reference.
  const freshPaid =
    (await redis.hgetall<Record<string, PaidEntry>>(K.paid)) ?? {};
  const toDelete: string[] = [];
  for (const [addr, entry] of Object.entries(freshPaid)) {
    if (!entry.bankr || now - entry.lastSeenAt > PRUNE_AFTER_MS) {
      toDelete.push(addr);
    }
  }
  if (toDelete.length > 0) {
    await redis.hdel(K.paid, ...(toDelete as [string, ...string[]]));
  }

  await pruneOldLaunches();
}

/** Returns all currently tracked paid Bankr launches. Called on every render. */
export async function getPaidBankrEntries(): Promise<
  Array<PaidEntry & { bankr: BankrLaunch }>
> {
  const all =
    (await redis.hgetall<Record<string, PaidEntry>>(K.paid)) ?? {};
  const out: Array<PaidEntry & { bankr: BankrLaunch }> = [];
  for (const entry of Object.values(all)) {
    if (entry.bankr) out.push(entry as PaidEntry & { bankr: BankrLaunch });
  }
  return out;
}

/**
 * One-time backfill: walk every deployer's full history and write launches to
 * the Redis index so the drain step covers their complete 14-day window —
 * not just the most recent 50. Safe to call from a slow cron or admin route.
 */
export async function backfillKnownDeployers(): Promise<void> {
  const launches = await fetchBankrLaunches().catch(() => []);
  const deployers = new Set(
    launches.map((l) => l.deployer.walletAddress.toLowerCase()),
  );
  let total = 0;
  for (const addr of deployers) {
    const n = await backfillDeployerHistory(addr).catch(() => 0);
    total += n;
  }
  console.log(
    `[paid-watcher] backfill: ${deployers.size} deployers, ${total} launches`,
  );
}
