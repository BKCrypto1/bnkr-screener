import {
  __launchCacheForWatcher,
  backfillDeployerHistory,
  fetchBankrLaunch,
  fetchBankrLaunches,
} from "./bankr";
import { getOrCreateDiskMap } from "./disk-cache";
import { fetchDexPairs, fetchPaidBaseSignals } from "./dexscreener";
import type { BankrLaunch } from "./types";

const POLL_INTERVAL_MS = 10_000;
// Pair sweeps every Nth tick — the sweep is expensive (one DexScreener call
// per 30 addresses, and launchCache may have thousands of entries once
// deployer-history backfill kicks in).
const SWEEP_EVERY_N_TICKS = 6; // → every 60s
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

    // (2) Sweep all known Bankr launches via the batched pair endpoint —
    // pair.boosts.active is the authoritative "currently boosted" field
    // (much more reliable than /orders/v1 or /token-boosts/latest, which
    // lag or drop entries). Throttled to every 60s to keep DexScreener
    // load reasonable as launchCache grows from deployer-history backfill.
    const tick = (globalThis.__bnkrScreenerPaidTickCount ?? 0) + 1;
    globalThis.__bnkrScreenerPaidTickCount = tick;
    const knownBankrAddrs =
      tick % SWEEP_EVERY_N_TICKS === 1 ? collectKnownBankrAddresses() : [];
    if (knownBankrAddrs.length > 0) {
      const pairs = await fetchDexPairs(knownBankrAddrs).catch(() => []);
      // Build a map: tokenAddress → highest pair.boosts.active across all
      // pairs for that token.
      const boostByToken = new Map<string, number>();
      for (const p of pairs) {
        const baseAddr = p.baseToken?.address?.toLowerCase();
        const active = p.boosts?.active ?? 0;
        if (baseAddr && active > 0) {
          boostByToken.set(
            baseAddr,
            Math.max(boostByToken.get(baseAddr) ?? 0, active),
          );
        }
      }
      for (const [addr, active] of boostByToken) {
        const prev = state.get(addr);
        let bankr = prev?.bankr;
        if (bankr === undefined) {
          bankr = await fetchBankrLaunch(addr).catch(() => null);
        }
        if (!bankr) continue;
        state.set(addr, {
          address: addr,
          boostAmount: active,
          totalBoostAmount: Math.max(prev?.totalBoostAmount ?? 0, active),
          hasProfile: prev?.hasProfile === true,
          firstPaidAt: prev?.firstPaidAt ?? now,
          lastSeenAt: now,
          bankr,
        });
      }
      // Decay: if an address was previously boosted but pair shows 0 now,
      // keep the entry (so it stays surfaced) but set boostAmount=0 so the
      // UI can decide to hide expired boosts. hasProfile / firstPaidAt stay.
      for (const [addr, entry] of state) {
        if (entry.boostAmount > 0 && !boostByToken.has(addr)) {
          // pair sweep didn't include this address (not in launchCache yet) —
          // leave untouched
          if (!knownBankrAddrs.includes(addr)) continue;
          state.set(addr, { ...entry, boostAmount: 0 });
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

/** Confirmed Bankr launches we've ever observed (positive launchCache entries). */
function collectKnownBankrAddresses(): string[] {
  const out: string[] = [];
  for (const [addr, entry] of __launchCacheForWatcher) {
    if (entry.value) out.push(addr);
  }
  return out;
}

async function backfillKnownDeployers() {
  if (globalThis.__bnkrScreenerBackfillDone) return;
  globalThis.__bnkrScreenerBackfillDone = true;
  try {
    const launches = await fetchBankrLaunches();
    const seen = new Set<string>();
    const deployers: string[] = [];
    for (const l of launches) {
      const addr = l.deployer.walletAddress.toLowerCase();
      if (seen.has(addr)) continue;
      seen.add(addr);
      deployers.push(addr);
    }
    // Sequential — relies on the bankrLimit(2) inside backfillDeployerHistory
    // to keep us from spiking. Logs each one so we can watch progress.
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
