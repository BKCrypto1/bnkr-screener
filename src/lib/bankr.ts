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
// invocation. Prevents double-fetching within a single request.
let launchesCache: { value: BankrLaunch[]; expiresAt: number } | null = null;
const LAUNCHES_TTL_MS = 3_000;
const LAUNCHES_STALE_MS = 60_000;

const LAUNCH_TTL_SEC = 24 * 60 * 60;
const LAUNCH_NEG_TTL_SEC = 5 * 60; // short — new tokens may not be indexed immediately
const DEPLOYER_TTL_SEC = 60 * 60;
const MAX_PAGES = 20;

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
  const hit = await redis
    .get<{ data: BankrLaunch | null }>(K.launch(key))
    .catch(() => null);
  if (hit !== null && hit !== undefined) return hit.data;

  const res = await bankrFetch(`${BANKR_LAUNCHES_URL}/${key}`, {
    cache: "no-store",
  });
  if (res.status === 404) {
    await redis
      .set(K.launch(key), { data: null }, { ex: LAUNCH_NEG_TTL_SEC })
      .catch(() => {});
    return null;
  }
  if (!res.ok) return null;
  const json = (await res.json()) as { launch: BankrLaunch };
  const value = json.launch ?? null;
  if (value) {
    await redis
      .set(K.launch(key), { data: value }, { ex: LAUNCH_TTL_SEC })
      .catch(() => {});
  }
  return value;
}

type DeployerSummary = {
  count: number;
  recent: BankrLaunch[];
  truncated: boolean;
};

export async function fetchDeployerLaunches(
  deployerAddress: string,
): Promise<DeployerSummary> {
  const key = deployerAddress.toLowerCase();
  const hit = await redis
    .get<DeployerSummary>(K.deployer(key))
    .catch(() => null);
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
  await redis
    .set(K.deployer(key), summary, { ex: DEPLOYER_TTL_SEC })
    .catch(() => {});
  return summary;
}
