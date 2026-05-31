import type { DexPair, DexPaidStatus } from "./types";

const DEXSCREENER_TOKENS_URL = "https://api.dexscreener.com/latest/dex/tokens";
const DEXSCREENER_ORDERS_URL = "https://api.dexscreener.com/orders/v1/base";
const DEXSCREENER_BOOSTS_LATEST = "https://api.dexscreener.com/token-boosts/latest/v1";
const DEXSCREENER_BOOSTS_TOP = "https://api.dexscreener.com/token-boosts/top/v1";
const DEXSCREENER_PROFILES_LATEST = "https://api.dexscreener.com/token-profiles/latest/v1";
const CHUNK_SIZE = 30;

const orderCache = new Map<string, { value: DexPaidStatus; expiresAt: number }>();
const ORDER_TTL_MS = 30 * 60 * 1000; // paid status is sticky once paid

export type PaidSignal = {
  address: string;
  boostAmount: number;
  hasProfile: boolean;
};

let paidBaseCache: { value: PaidSignal[]; expiresAt: number } | null = null;
const PAID_BASE_TTL_MS = 5 * 60 * 1000;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function fetchDexPairs(addresses: string[]): Promise<DexPair[]> {
  if (addresses.length === 0) return [];
  const unique = Array.from(new Set(addresses.map((a) => a.toLowerCase())));
  const groups = chunk(unique, CHUNK_SIZE);
  const results = await Promise.all(
    groups.map(async (group) => {
      const url = `${DEXSCREENER_TOKENS_URL}/${group.join(",")}`;
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "bnkrscreener/0.1 (+https://github.com/)",
        },
        next: { revalidate: 10 },
      });
      if (!res.ok) return [];
      const json = (await res.json()) as { pairs: DexPair[] | null };
      return json.pairs ?? [];
    }),
  );
  return results.flat();
}

export async function fetchDexPaidStatus(
  tokenAddress: string,
): Promise<DexPaidStatus> {
  const key = tokenAddress.toLowerCase();
  const now = Date.now();
  const hit = orderCache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;
  try {
    const res = await fetch(`${DEXSCREENER_ORDERS_URL}/${key}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "bnkrscreener/0.1 (+https://github.com/)",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      const empty: DexPaidStatus = {
        boosted: false,
        boostAmount: 0,
        totalBoostAmount: 0,
        hasProfile: false,
        orderTypes: [],
      };
      return hit?.value ?? empty;
    }
    const json = (await res.json()) as {
      orders?: Array<{ type: string; status: string }>;
      boosts?: Array<{ amount: number }>;
    };
    const boosts = json.boosts ?? [];
    const orders = json.orders ?? [];
    const approved = orders.filter((o) => o.status === "approved");
    const orderTypes = Array.from(new Set(approved.map((o) => o.type)));
    const value: DexPaidStatus = {
      boosted: boosts.length > 0,
      boostAmount: boosts.reduce((s, b) => s + (b.amount ?? 0), 0),
      totalBoostAmount: boosts.reduce((s, b) => s + (b.amount ?? 0), 0),
      hasProfile: orderTypes.includes("tokenProfile"),
      orderTypes,
    };
    orderCache.set(key, { value, expiresAt: now + ORDER_TTL_MS });
    return value;
  } catch {
    return (
      hit?.value ?? {
        boosted: false,
        boostAmount: 0,
        totalBoostAmount: 0,
        hasProfile: false,
        orderTypes: [],
      }
    );
  }
}

export async function fetchPaidBaseSignals(): Promise<PaidSignal[]> {
  const now = Date.now();
  if (paidBaseCache && paidBaseCache.expiresAt > now) return paidBaseCache.value;
  const headers = {
    Accept: "application/json",
    "User-Agent": "bnkrscreener/0.1 (+https://github.com/)",
  };
  try {
    const [latestBoosts, topBoosts, profiles] = await Promise.all([
      fetch(DEXSCREENER_BOOSTS_LATEST, { headers, cache: "no-store" }).then(
        (r) =>
          r.ok
            ? (r.json() as Promise<
                Array<{
                  chainId?: string;
                  tokenAddress?: string;
                  amount?: number;
                  totalAmount?: number;
                }>
              >)
            : [],
      ),
      fetch(DEXSCREENER_BOOSTS_TOP, { headers, cache: "no-store" }).then((r) =>
        r.ok
          ? (r.json() as Promise<
              Array<{
                chainId?: string;
                tokenAddress?: string;
                amount?: number;
                totalAmount?: number;
              }>
            >)
          : [],
      ),
      fetch(DEXSCREENER_PROFILES_LATEST, { headers, cache: "no-store" }).then(
        (r) =>
          r.ok
            ? (r.json() as Promise<
                Array<{ chainId?: string; tokenAddress?: string }>
              >)
            : [],
      ),
    ]);
    const acc = new Map<string, PaidSignal>();
    function upsertBoost(items: Array<{
      chainId?: string;
      tokenAddress?: string;
      amount?: number;
      totalAmount?: number;
    }>) {
      for (const it of items) {
        if (it.chainId !== "base" || !it.tokenAddress) continue;
        const addr = it.tokenAddress.toLowerCase();
        const prev = acc.get(addr) ?? {
          address: addr,
          boostAmount: 0,
          hasProfile: false,
        };
        const amt = Math.max(it.totalAmount ?? 0, it.amount ?? 0);
        if (amt > prev.boostAmount) prev.boostAmount = amt;
        acc.set(addr, prev);
      }
    }
    upsertBoost(latestBoosts);
    upsertBoost(topBoosts);
    for (const p of profiles) {
      if (p.chainId !== "base" || !p.tokenAddress) continue;
      const addr = p.tokenAddress.toLowerCase();
      const prev = acc.get(addr) ?? {
        address: addr,
        boostAmount: 0,
        hasProfile: false,
      };
      prev.hasProfile = true;
      acc.set(addr, prev);
    }
    const value = Array.from(acc.values());
    paidBaseCache = { value, expiresAt: now + PAID_BASE_TTL_MS };
    return value;
  } catch {
    return paidBaseCache?.value ?? [];
  }
}

export function pickBestPair(
  tokenAddress: string,
  pairs: DexPair[],
): DexPair | undefined {
  const addr = tokenAddress.toLowerCase();
  const candidates = pairs.filter(
    (p) =>
      p.baseToken.address.toLowerCase() === addr ||
      p.quoteToken.address.toLowerCase() === addr,
  );
  if (candidates.length === 0) return undefined;
  return candidates.sort(
    (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
  )[0];
}
