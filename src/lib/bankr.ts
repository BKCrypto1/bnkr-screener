import { createLimit } from "./limit";
import { K, redis } from "./redis";
import type { BankrLaunch } from "./types";

const BANKR_LAUNCHES_URL = "https://api.bankr.bot/token-launches";

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

// Short in-process dedup cache — only valid for the lifetime of one function
// invocation. Prevents double-fetching within a single request. Does not
// persist across serverless invocations (that's what Redis is for).
let launchesCache: { value: BankrLaunch[]; expiresAt: number } | null = null;
const LAUNCHES_TTL_MS = 3_000;
const LAUNCHES_STALE_MS = 60_000;

const LAUNCH_TTL_SEC = 24 * 60 * 60; // 24h — token metadata rarely changes
const LAUNCH_NEG_TTL_SEC = 60 * 60; // 1h for confirmed non-Bankr addresses
const LAUNCH_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const DEPLOYER_TTL_SEC = 6 * 60 * 60; // 6h — lifetime count barely moves
const MAX_PAGES = 20; // 50/page × 20 = 1000 launches max per deployer walk

function shouldCacheLaunch(launch: BankrLaunch): boolean {
  return launch.timestamp >= Date.now() - LAUNCH_RETENTION_MS;
}

export async function writeLaunchesToRedis(launches: BankrLaunch[]) {
  const toWrite = launches.filter(shouldCacheLaunch);
  if (toWrite.length === 0) return;
  const pipeline = redis.pipeline();
  for (const launch of toWrite) {
    const addr = launch.tokenAddress.toLowerCase();
    pipeline.set(K.launch(addr), { data: launch }, { ex: LAUNCH_TTL_SEC });
    pipeline.zadd(K.launchIndex, { score: launch.timestamp, member: addr });
  }
  await pipeline.exec();
}

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
    return value;
  } catch (err) {
    if (launchesCache) return launchesCache.value;
    throw err;
  }
}

export async function fetchBankrLaunch(
  address: string,
): Promise<BankrLaunch | null> {
  const key = address.toLowerCase();
  const hit = await redis.get<{ data: BankrLaunch | null }>(K.launch(key)).catch(() => null);
  if (hit !== null && hit !== undefined) return hit.data;

  const res = await bankrFetch(`${BANKR_LAUNCHES_URL}/${key}`, {
    cache: "no-store",
  });
  if (res.status === 404) {
    await redis.set(K.launch(key), { data: null }, { ex: LAUNCH_NEG_TTL_SEC });
    return null;
  }
  if (!res.ok) return null;
  const json = (await res.json()) as { launch: BankrLaunch };
  const value = json.launch ?? null;
  if (value) {
    const pipeline = redis.pipeline();
    pipeline.set(K.launch(key), { data: value }, { ex: LAUNCH_TTL_SEC });
    if (shouldCacheLaunch(value)) {
      pipeline.zadd(K.launchIndex, { score: value.timestamp, member: key });
    }
    await pipeline.exec();
  }
  return value;
}

type DeployerSummary = { count: number; recent: BankrLaunch[]; truncated: boolean };

export async function fetchDeployerLaunches(
  deployerAddress: string,
): Promise<DeployerSummary> {
  const key = deployerAddress.toLowerCase();
  const hit = await redis.get<DeployerSummary>(K.deployer(key)).catch(() => null);
  if (hit) return hit;

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
    pages += 1;
    if (!json.nextCursor || results.length === 0) break;
    if (pages >= MAX_PAGES) {
      truncated = true;
      break;
    }
    cursor = json.nextCursor;
  }

  const summary: DeployerSummary = { count, recent, truncated };
  await redis.set(K.deployer(key), summary, { ex: DEPLOYER_TTL_SEC });
  return summary;
}

export async function backfillDeployerHistory(
  deployerAddress: string,
): Promise<number> {
  const key = deployerAddress.toLowerCase();
  let cursor = "";
  let count = 0;
  let pages = 0;

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
    const withinWindow = results.filter(shouldCacheLaunch);
    await writeLaunchesToRedis(withinWindow);
    pages += 1;
    if (!json.nextCursor || results.length === 0) break;
    if (pages >= MAX_PAGES) break;
    // Results come back reverse-chronological. If the whole page was outside
    // the 14-day window, every subsequent page will be too.
    if (results.length > 0 && withinWindow.length === 0) break;
    cursor = json.nextCursor;
  }
  return count;
}

export async function pruneOldLaunches(): Promise<number> {
  const cutoff = Date.now() - LAUNCH_RETENTION_MS;
  const removed = await redis.zremrangebyscore(K.launchIndex, 0, cutoff);
  return typeof removed === "number" ? removed : 0;
}

/** All token addresses in the launch index from the last 14 days. */
export async function getRecentLaunchAddresses(): Promise<string[]> {
  const cutoff = Date.now() - LAUNCH_RETENTION_MS;
  const result = await redis.zrange(K.launchIndex, cutoff, "+inf", {
    byScore: true,
  });
  return result as string[];
}
