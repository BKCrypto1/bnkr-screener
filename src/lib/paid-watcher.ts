import {
  __launchCacheForWatcher,
  backfillDeployerHistory,
  fetchBankrLaunch,
  fetchBankrLaunches,
  pruneOldLaunches,
} from "./bankr";
import { getOrCreateDiskMap } from "./disk-cache";
import {
  fetchDexPairs,
  fetchDexPairsForToken,
  fetchPaidBaseSignals,
} from "./dexscreener";
import type { BankrLaunch } from "./types";

const POLL_INTERVAL_MS = 10_000;
// Each address in the 14-day launchCache is checked exactly once. After
// that we rely on (a) the global boost/profile feeds for new payments and
// (b) the per-known-paid sweep for expiry/upgrade detection. New launches
// entering launchCache from the live feed get checked on the next poll.
// MAX_DRAIN caps how many unchecked addresses we process per 10s tick so
// the initial cold-start drain doesn't burst DexScreener.
const MAX_DRAIN_PER_TICK = 200;
const CACHE_PATH = "/tmp/bankr-screener/paid-watcher.json";
const GLOBAL_KEY = "__bnkrScreenerPaidState";

export type PaidEntry = {
  address: string;
  boostAmount: number;
  totalBoostAmount: number;
  hasProfile: boolean;
  /** When we first observed this address as paid */
  firstPaidAt: number;
  /** Last observed paid */
  lastSeenAt: number;
  /** Cached BankrLaunch if known to be a Bankr launch; null if confirmed non-Bankr; absent if not yet classified */
  bankr?: BankrLaunch | null;
};

const state = getOrCreateDiskMap<PaidEntry>(GLOBAL_KEY, CACHE_PATH);

declare global {
  // eslint-disable-next-line no-var
  var __bnkrScreenerPaidTimer: ReturnType<typeof setInterval> | undefined;
  // eslint-disable-next-line no-var
  var __bnkrScreenerPaidRunning: boolean | undefined;
  // eslint-disable-next-line no-var
  var __bnkrScreenerCheckedAddrs: Set<string> | undefined;
}

/**
 * Addresses we've already pair-checked since the process started. Not
 * persisted — on restart we re-check, which acts as a self-heal sweep
 * for payments made while the process was down.
 */
function getCheckedSet(): Set<string> {
  if (!globalThis.__bnkrScreenerCheckedAddrs) {
    globalThis.__bnkrScreenerCheckedAddrs = new Set<string>();
  }
  return globalThis.__bnkrScreenerCheckedAddrs;
}

async function pollOnce() {
  if (globalThis.__bnkrScreenerPaidRunning) return;
  globalThis.__bnkrScreenerPaidRunning = true;
  try {
    const now = Date.now();

    // (1) Pull DexScreener's global feeds — discovers brand new paid addresses
    // before they enter our known-Bankr set.
    const signals = await fetchPaidBaseSignals().catch(() => []);
    for (const sig of signals) {
      const addr = sig.address.toLowerCase();
      const prev = state.get(addr);
      let bankr = prev?.bankr;
      if (bankr === undefined) {
        bankr = await fetchBankrLaunch(addr).catch(() => null);
      }
      // Skip non-Bankr tokens — the global feeds catch everything on Base
      // and we only want Bankr launches in our paid set.
      if (!bankr) continue;
      state.set(addr, {
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
      });
    }

    // (2) Always: re-check currently-known paid addresses INDIVIDUALLY.
    // Using fetchDexPairsForToken (one address per call) avoids the
    // 30-pair cap of batched calls. With ~10 paid tokens this is ~10
    // requests per 10s = 60/min — well within DexScreener's limits.
    const knownPaidAddrs = Array.from(state.keys()).filter((a) => {
      const e = state.get(a);
      return e && (e.boostAmount > 0 || e.hasProfile);
    });
    for (const addr of knownPaidAddrs) {
      const pairs = await fetchDexPairsForToken(addr).catch(() => []);
      const best = pairs
        .filter((p) => p.baseToken?.address?.toLowerCase() === addr)
        .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
      if (!best) continue; // can't tell if status changed — leave entry alone
      const active = best.boosts?.active ?? 0;
      const hasProfile = isPaidProfile(best);
      const prev = state.get(addr);
      if (!prev || !prev.bankr) continue;
      // Both signals follow live pair data — not sticky. If a team removes
      // their profile or their boost expires, the badge disappears.
      state.set(addr, {
        ...prev,
        boostAmount: active,
        totalBoostAmount: Math.max(prev.totalBoostAmount, active),
        hasProfile,
        lastSeenAt: now,
      });
    }

    // (3) Drain unchecked addresses: find any 14-day launchCache entries
    // we haven't pair-checked yet (since process start) and check them
    // once. New launches entering launchCache via the live /token-launches
    // feed get caught here on the next 10s tick. After the initial
    // drain completes, this becomes ~0 work per tick (only new launches).
    const checked = getCheckedSet();
    const allKnown = collectKnownBankrAddresses();
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
        const prev = state.get(addr);
        let bankr = prev?.bankr;
        if (bankr === undefined) {
          bankr = await fetchBankrLaunch(addr).catch(() => null);
        }
        if (!bankr) continue;
        state.set(addr, {
          address: addr,
          boostAmount: sig.boost,
          totalBoostAmount: Math.max(prev?.totalBoostAmount ?? 0, sig.boost),
          hasProfile: sig.profile || prev?.hasProfile === true,
          firstPaidAt: prev?.firstPaidAt ?? now,
          lastSeenAt: now,
          bankr,
        });
      }
      // Mark all batch addresses as checked — we don't re-check unchecked
      // addresses with no signal; we trust them until they appear in a
      // global feed (boost/profile freshly paid) or get manually visited.
      for (const a of batch) checked.add(a);
    }

    // Prune watcher entries we haven't observed in 7 days, plus any
    // phantom entries that somehow got in without a bankr reference.
    const PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
    for (const [k, v] of Array.from(state.entries())) {
      if (!v.bankr) state.delete(k);
      else if (now - v.lastSeenAt > PRUNE_AFTER_MS) state.delete(k);
    }

    // Prune launchCache entries that have aged past the 14d retention
    // window. Cheap iteration; usually a no-op except for entries that
    // just crossed the boundary since the last poll.
    const prunedLaunches = pruneOldLaunches();
    if (prunedLaunches > 0) {
      // also drop them from the "checked" set so the Set doesn't bloat
      const cs = getCheckedSet();
      const stillKnown = new Set(__launchCacheForWatcher.keys());
      for (const a of Array.from(cs)) {
        if (!stillKnown.has(a)) cs.delete(a);
      }
    }
  } catch (err) {
    console.error("[paid-watcher] poll failed:", err);
  } finally {
    globalThis.__bnkrScreenerPaidRunning = false;
  }
}

/**
 * Test pair.info for paid Enhanced Token Info signals.
 *
 * Teams that pay for Enhanced Token Info can independently choose to
 * upload a banner (info.header), websites, or socials. Some pay and
 * upload only websites/socials but skip the banner (e.g. eiplawb).
 * Free tokens get only auto-populated info.imageUrl and info.openGraph
 * but NEVER websites or socials — so any of header/websites/socials is
 * a reliable "paid" signal.
 */
function isPaidProfile(p: {
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
 * Confirmed Bankr launches from the last 14 days. We don't sweep beyond
 * that window because (a) the Paid DEX filter only shows last-14-day
 * tokens anyway and (b) sweeping the full launchCache (often thousands
 * of historical entries) hammers DexScreener and triggers rate limits.
 */
const SWEEP_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
function collectKnownBankrAddresses(): string[] {
  const out: string[] = [];
  const cutoff = Date.now() - SWEEP_WINDOW_MS;
  for (const [addr, entry] of __launchCacheForWatcher) {
    const launch = entry.value;
    if (!launch) continue;
    if (launch.timestamp < cutoff) continue;
    out.push(addr);
  }
  return out;
}

async function backfillKnownDeployers() {
  if (globalThis.__bnkrScreenerBackfillDone) return;
  globalThis.__bnkrScreenerBackfillDone = true;
  try {
    // Harvest distinct deployer addresses from EVERY launch in launchCache
    // (not just the recent 50). As launchCache grows, this set grows, and
    // each subsequent run picks up new deployers.
    await fetchBankrLaunches().catch(() => []); // populate latest first
    const seen = new Set<string>();
    for (const [, entry] of __launchCacheForWatcher) {
      const dep = entry.value?.deployer?.walletAddress?.toLowerCase();
      if (dep) seen.add(dep);
    }
    const deployers = Array.from(seen);
    // Sequential — relies on bankrLimit(2) inside backfillDeployerHistory
    // to pace requests. May take a few minutes for 60+ deployers.
    let total = 0;
    for (const addr of deployers) {
      const n = await backfillDeployerHistory(addr).catch(() => 0);
      total += n;
    }
    console.log(
      `[paid-watcher] backfill complete: ${deployers.length} deployers, ${total} launches cached`,
    );
  } catch (err) {
    console.error("[paid-watcher] backfill failed:", err);
  }
}

function startWatcher() {
  if (globalThis.__bnkrScreenerPaidTimer) return;
  // Kick off the first poll immediately, then on interval.
  void pollOnce();
  globalThis.__bnkrScreenerPaidTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
  // Background-backfill deployer histories so the pair-sweep covers all
  // their launches, not just the ones currently in the recent 50.
  void backfillKnownDeployers();
}

declare global {
  // eslint-disable-next-line no-var
  var __bnkrScreenerBackfillDone: boolean | undefined;
}

startWatcher();

/** Returns Bankr-launched paid entries currently tracked by the watcher. */
export function getPaidBankrEntries(): Array<PaidEntry & { bankr: BankrLaunch }> {
  const out: Array<PaidEntry & { bankr: BankrLaunch }> = [];
  for (const entry of state.values()) {
    if (entry.bankr) out.push({ ...entry, bankr: entry.bankr });
  }
  return out;
}
