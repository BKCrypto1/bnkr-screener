const GT_BASE = "https://api.geckoterminal.com/api/v2/networks/base";

const headers = {
  Accept: "application/json;version=20230302",
  "User-Agent": "bnkrscreener/0.1 (+https://github.com/)",
};

type CacheEntry = { value: unknown; expiresAt: number };
const memCache = new Map<string, CacheEntry>();

async function cachedFetch<T>(
  url: string,
  ttlMs: number,
  parse: (json: unknown) => T,
): Promise<T> {
  const now = Date.now();
  const hit = memCache.get(url);
  if (hit && hit.expiresAt > now) return hit.value as T;
  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) {
    if (hit) return hit.value as T;
    throw new Error(`GeckoTerminal ${res.status} ${url}`);
  }
  const json = await res.json();
  const value = parse(json);
  memCache.set(url, { value, expiresAt: now + ttlMs });
  return value;
}

export type Timeframe = "minute" | "hour" | "day";

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type GtTrade = {
  blockNumber: number;
  txHash: string;
  wallet: string;
  fromTokenAddress: string;
  toTokenAddress: string;
  fromTokenAmount: string;
  toTokenAmount: string;
  priceFromInUsd: string;
  priceToInUsd: string;
  volumeUsd: number;
  blockTimestamp: number;
  kind: "buy" | "sell";
};

type OhlcvRow = [number, number, number, number, number, number];

export async function fetchOhlcv(
  poolAddress: string,
  timeframe: Timeframe = "minute",
  aggregate: number = 1,
  limit: number = 500,
): Promise<Candle[]> {
  const url = `${GT_BASE}/pools/${poolAddress.toLowerCase()}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${limit}&currency=usd`;
  return cachedFetch<Candle[]>(url, 10_000, (json) => {
    const j = json as { data?: { attributes?: { ohlcv_list?: OhlcvRow[] } } };
    const list = j.data?.attributes?.ohlcv_list ?? [];
    return list
      .map((r) => ({
        time: r[0],
        open: r[1],
        high: r[2],
        low: r[3],
        close: r[4],
        volume: r[5],
      }))
      .sort((a, b) => a.time - b.time);
  });
}

export async function fetchTrades(
  poolAddress: string,
  minVolumeUsd: number = 0,
): Promise<GtTrade[]> {
  const url = `${GT_BASE}/pools/${poolAddress.toLowerCase()}/trades?trade_volume_in_usd_greater_than=${minVolumeUsd}`;
  return cachedFetch<GtTrade[]>(url, 5_000, (json) => {
    const j = json as {
      data?: Array<{ attributes: Record<string, string | number> }>;
    };
    const list = j.data ?? [];
    return list.map((row) => {
      const a = row.attributes;
      return {
        blockNumber: Number(a.block_number),
        txHash: String(a.tx_hash),
        wallet: String(a.tx_from_address),
        fromTokenAddress: String(a.from_token_address),
        toTokenAddress: String(a.to_token_address),
        fromTokenAmount: String(a.from_token_amount),
        toTokenAmount: String(a.to_token_amount),
        priceFromInUsd: String(a.price_from_in_usd),
        priceToInUsd: String(a.price_to_in_usd),
        volumeUsd: Number(a.volume_in_usd),
        blockTimestamp: Math.floor(
          new Date(String(a.block_timestamp)).getTime() / 1000,
        ),
        kind: String(a.kind) === "buy" ? "buy" : "sell",
      };
    });
  });
}

export async function fetchTopPoolForToken(
  tokenAddress: string,
): Promise<string | null> {
  const url = `${GT_BASE}/tokens/${tokenAddress.toLowerCase()}`;
  try {
    return await cachedFetch<string | null>(url, 60_000, (json) => {
      const j = json as {
        data?: {
          relationships?: { top_pools?: { data?: Array<{ id: string }> } };
        };
      };
      const id = j.data?.relationships?.top_pools?.data?.[0]?.id;
      if (!id) return null;
      return id.replace(/^base_/, "");
    });
  } catch {
    return null;
  }
}
