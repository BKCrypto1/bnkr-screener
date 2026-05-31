import {
  __launchCacheForWatcher,
  backfillDeployerHistory,
  fetchBankrLaunch,
  fetchBankrLaunches,
} from "./bankr";
import { getOrCreateDiskMap } from "./disk-cache";
import {
  fetchDexPairs,
  fetchDexPairsForToken,
  fetchPaidBaseSignals,
} from "./dexscreener";
import type { BankrLaunch } from "./types";

const POLL_INTERVAL_MS = 10_000;
// Discovery (rotating) sweep cadence — every N ticks.
const SWEEP_EVERY_N_TICKS = 6; // → every 60s
// How many addresses to scan per rotation cycle. ~2 batched DexScreener calls.
const ROTATION_BATCH = 60;
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
  var __bnkrScreenerPaidTickCount: number | undefined;
  // eslint-disable-next-line no-var
  var __bnkrScreenerSweepCursor: number | undefined;
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
      const hasProfile = !!best.info?.header;
      const prev = state.get(addr);
      if (!prev || !prev.bankr) continue;
      state.set(addr, {
        ...prev,
        boostAmount: active,
        totalBoostAmount: Math.max(prev.totalBoostAmount, active),
        hasProfile: hasProfile || prev.hasProfile,
        lastSeenAt: now,
      });
    }

    // (3) Rotating discovery sweep every 60s — scan a slice of the
    // 14-day launchCache to find newly-paid tokens. Full rotation takes
    // ~80 min at 60 addresses per sweep with ~5000 entries, but truly
    // new paid signals usually surface via the global feeds (faster).
    const tick = (globalThis.__bnkrScreenerPaidTickCount ?? 0) + 1;
    globalThis.__bnkrScreenerPaidTickCount = tick;
    if (tick % SWEEP_EVERY_N_TICKS === 1) {
      const allKnown = collectKnownBankrAddresses();
      if (allKnown.length > 0) {
        const cursor =
          (globalThis.__bnkrScreenerSweepCursor ?? 0) % allKnown.length;
        const slice = [
          ...allKnown.slice(cursor, cursor + ROTATION_BATCH),
          ...(cursor + ROTATION_BATCH > allKnown.length
            ? allKnown.slice(0, cursor + ROTATION_BATCH - allKnown.length)
            : []),
        ];
        globalThis.__bnkrScreenerSweepCursor =
          (cursor + ROTATION_BATCH) % allKnown.length;
        const pairs = await fetchDexPairs(slice).catch(() => []);
        // Profile signal: only info.header (paid banner image).
        // Boost signal: boosts.active.
        type Sig = { boost: number; profile: boolean };
        const sigByToken = new Map<string, Sig>();
        for (const p of pairs) {
          const baseAddr = p.baseToken?.address?.toLowerCase();
          if (!baseAddr) continue;
          const active = p.boosts?.active ?? 0;
          const hasProfile = !!p.info?.header;
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
      }
    }

    // Prune entries we haven't observed in 7 days to keep file size bounded.
    const PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
    for (const [k, v] of Array.from(state.entries())) {
      if (now - v.lastSeenAt > PRUNE_AFTER_MS) state.delete(k);
    }
  } catch (err) {
    console.error("[paid-watcher] poll failed:", err);
  } finally {
    globalThis.__bnkrScreenerPaidRunning = false;
  }
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
