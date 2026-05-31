import { getOrCreateDiskMap } from "./disk-cache";
import { createLimit } from "./limit";
import type { BankrLaunch } from "./types";

const BANKR_LAUNCHES_URL = "https://api.bankr.bot/token-launches";
const CACHE_DIR = "/tmp/bankr-screener";

// Cap parallel calls to Bankr's API so we never burst.
// Bankr is behind Cloudflare and IP-bans aggressive callers.
const bankrLimit = createLimit(2);

function bankrFetch(url: string, init?: RequestInit): Promise<Response> {
  return bankrLimit(() =>
    fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        "User-Agent": "bnkrscreener/0.1 (+https://github.com/)",
        ...(init?.headers ?? {}),
      },
    }),
  );
}

let launchesCache: { value: BankrLaunch[]; expiresAt: number } | null = null;
const LAUNCHES_TTL_MS = 3 * 1000;
const LAUNCHES_STALE_MS = 60 * 1000; // keep serving stale up to 1 min if upstream fails

export async function fetchBankrLaunches(): Promise<BankrLaunch[]> {
  const now = Date.now();
  if (launchesCache && launchesCache.expiresAt > now) return launchesCache.value;
  try {
    const res = await bankrFetch(BANKR_LAUNCHES_URL, { cache: "no-store" });
    if (!res.ok) {
      if (launchesCache && launchesCache.expiresAt + LAUNCHES_STALE_MS > now) {
        return launchesCache.value;
      }
      throw new Error(`Bankr launches fetch failed: ${res.status}`);
    }
    const json = (await res.json()) as { launches: BankrLaunch[] };
    const value = json.launches ?? [];
    launchesCache = { value, expiresAt: now + LAUNCHES_TTL_MS };
    // Populate the per-token launchCache from the feed so the paid watcher
    // can classify boosted addresses without a separate Bankr lookup.
    // (Live feed entries are always within minutes so the retention check is
    // effectively a no-op here, but keep it for symmetry.)
    const launchExpiresAt = now + LAUNCH_TTL_MS;
    for (const launch of value) {
      if (!shouldCacheLaunch(launch)) continue;
      launchCache.set(launch.tokenAddress.toLowerCase(), {
        value: launch,
        expiresAt: launchExpiresAt,
      });
    }
    return value;
  } catch (err) {
    if (launchesCache) return launchesCache.value;
    throw err;
  }
}

type DeployerSummary = { count: number; recent: BankrLaunch[]; truncated: boolean };
type DeployerCacheEntry = { value: DeployerSummary; expiresAt: number };
const deployerCache = getOrCreateDiskMap<DeployerCacheEntry>(
  "__bnkrScreenerDeployerCache",
  `${CACHE_DIR}/deployer-cache.json`,
);
const DEPLOYER_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — lifetime count barely moves
const MAX_PAGES = 20; // 50/page × 20 = 1000 launches max

/**
 * Walk a deployer's full launch history, writing every launch to
 * launchCache. Ignores the deployer count cache and always paginates.
 * Used by paid-watcher's startup backfill so the pair-sweep covers a
 * deployer's full history, not just their 50 most recent.
 */
export async function backfillDeployerHistory(
  deployerAddress: string,
): Promise<number> {
  const key = deployerAddress.toLowerCase();
  let cursor = "";
  let count = 0;
  let pages = 0;
  const now = Date.now();
  while (true) {
    const url = new URL(
      "https://api.bankr.bot/token-launches/search/paginated",
    );
    url.searchParams.set("q", key);
    url.searchParams.set("limit", "50");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await bankrFetch(url.toString(), { cache: "no-store" });
    if (!res.ok) break;
    const json = (await res.json()) as {
      results?: BankrLaunch[];
      nextCursor?: string;
    };
    const results = json.results ?? [];
    count += results.length;
    const launchExpiresAt = now + LAUNCH_TTL_MS;
    let writtenInPage = 0;
    for (const launch of results) {
      if (!shouldCacheLaunch(launch)) continue;
      launchCache.set(launch.tokenAddress.toLowerCase(), {
        value: launch,
        expiresAt: launchExpiresAt,
      });
      writtenInPage += 1;
    }
    pages += 1;
    if (!json.nextCursor || results.length === 0) break;
    if (pages >= MAX_PAGES) break;
    // Optimization: results come back in reverse-chronological order from
    // Bankr. If the entire page was older than the retention window, every
    // subsequent page will be too — stop paginating.
    if (results.length > 0 && writtenInPage === 0) break;
    cursor = json.nextCursor;
  }
  return count;
}

export async function fetchDeployerLaunches(
  deployerAddress: string,
): Promise<DeployerSummary> {
  const key = deployerAddress.toLowerCase();
  const now = Date.now();
  const hit = deployerCache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  let cursor = "";
  let count = 0;
  let pages = 0;
  const recent: BankrLaunch[] = [];
  let truncated = false;
  while (true) {
    const url = new URL(
      "https://api.bankr.bot/token-launches/search/paginated",
    );
    url.searchParams.set("q", key);
    url.searchParams.set("limit", "50");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await bankrFetch(url.toString(), { cache: "no-store" });
    if (!res.ok) {
      if (hit) return hit.value;
      // Don't throw — return what we have so far (possibly empty) and let
      // the next request retry. Avoids cascading 403s into UI errors.
      return { count, recent, truncated: true };
    }
    const json = (await res.json()) as {
      results?: BankrLaunch[];
      nextCursor?: string;
    };
    const results = json.results ?? [];
    count += results.length;
    if (recent.length < 12) {
      recent.push(...results.slice(0, 12 - recent.length));
    }
    // Backfill launchCache with launches inside the retention window only —
    // older launches don't help the Paid DEX filter / watcher sweep and just
    // bloat disk.
    const launchExpiresAt = now + LAUNCH_TTL_MS;
    for (const launch of results) {
      if (!shouldCacheLaunch(launch)) continue;
      launchCache.set(launch.tokenAddress.toLowerCase(), {
        value: launch,
        expiresAt: launchExpiresAt,
      });
    }
    pages += 1;
    if (!json.nextCursor || results.length === 0) break;
    if (pages >= MAX_PAGES) {
      truncated = true;
      break;
    }
    cursor = json.nextCursor;
  }
  const summary: DeployerSummary = { count, recent, truncated };
  deployerCache.set(key, { value: summary, expiresAt: now + DEPLOYER_TTL_MS });
  return summary;
}

type LaunchCacheEntry = { value: BankrLaunch | null; expiresAt: number };
const launchCache = getOrCreateDiskMap<LaunchCacheEntry>(
  "__bnkrScreenerLaunchCache",
  `${CACHE_DIR}/launch-cache.json`,
);
// Re-export the Map under a known property name so paid-watcher can read it
// without a circular import.
export const __launchCacheForWatcher = launchCache;
// Token launches are effectively immutable once deployed (metadata rarely
// changes), so we can cache positive responses for a long time. Disk
// persistence means a successful lookup survives both restarts and Bankr blocks.
const LAUNCH_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const LAUNCH_NEG_TTL_MS = 60 * 60 * 1000; // 1 hour — not Bankr launches stay not-Bankr

// Retention window: only keep launches younger than this. Everything in our
// Paid DEX filter and watcher sweeps operates on the last 14 days, so older
// entries are dead weight — they bloat disk and slow startup. Lookups for
// pruned addresses still work; fetchBankrLaunch will re-fetch on demand.
const LAUNCH_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export function pruneOldLaunches(): number {
  const cutoff = Date.now() - LAUNCH_RETENTION_MS;
  let removed = 0;
  for (const [addr, entry] of Array.from(launchCache.entries())) {
    const ts = entry.value?.timestamp;
    if (ts !== undefined && ts < cutoff) {
      launchCache.delete(addr);
      removed += 1;
    }
  }
  return removed;
}

// Prune on module load (once per process start)
{
  const removed = pruneOldLaunches();
  if (removed > 0) {
    console.log(`[bankr] pruned ${removed} launchCache entries older than 14d`);
  }
}

/** Test the timestamp against the retention window. */
function shouldCacheLaunch(launch: BankrLaunch): boolean {
  return launch.timestamp >= Date.now() - LAUNCH_RETENTION_MS;
}

export async function fetchBankrLaunch(
  address: string,
): Promise<BankrLaunch | null> {
  const key = address.toLowerCase();
  const now = Date.now();
  const hit = launchCache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;
  const res = await bankrFetch(`${BANKR_LAUNCHES_URL}/${key}`, {
    cache: "no-store",
  });
  if (res.status === 404) {
    launchCache.set(key, { value: null, expiresAt: now + LAUNCH_NEG_TTL_MS });
    return null;
  }
  if (!res.ok) {
    // Rate-limited or upstream error — return cached value if any (even if
    // expired), else null. Don't throw: callers shouldn't crash on transient
    // Bankr 403/429/5xx.
    if (hit) return hit.value;
    return null;
  }
  const json = (await res.json()) as { launch: BankrLaunch };
  const value = json.launch ?? null;
  launchCache.set(key, { value, expiresAt: now + LAUNCH_TTL_MS });
  return value;
}
