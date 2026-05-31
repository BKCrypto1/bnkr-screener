import type { GoplusResult } from "./types";

const GOPLUS_URL = "https://api.gopluslabs.io/api/v1/token_security/8453";

function parseResult(raw: Record<string, unknown>): Omit<GoplusResult, "fetchedAt"> {
  const allHolders = (raw.holders ?? []) as Array<{
    address: string;
    percent?: string;
    is_contract?: string | number;
  }>;
  const eoa = allHolders
    .filter((h) => String(h.is_contract) !== "1")
    .map((h) => ({ address: h.address, percent: parseFloat(h.percent ?? "0") }))
    .sort((a, b) => b.percent - a.percent);

  return {
    isInDex: raw.is_in_dex === "1",
    isHoneypot: raw.is_honeypot === "1",
    whaleCount: eoa.filter((h) => h.percent > 0.05).length,
    largeCount: eoa.filter((h) => h.percent >= 0.03 && h.percent <= 0.05).length,
    mediumCount: eoa.filter((h) => h.percent >= 0.01 && h.percent < 0.03).length,
    topHolders: eoa.slice(0, 10),
  };
}

export async function fetchTokenSecurityBatch(
  addresses: string[],
): Promise<Record<string, GoplusResult>> {
  if (addresses.length === 0) return {};
  const addrs = addresses.map((a) => a.toLowerCase());
  const res = await fetch(
    `${GOPLUS_URL}?contract_addresses=${addrs.join(",")}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "bnkrscreener/0.1 (+https://github.com/)",
      },
      cache: "no-store",
    },
  );
  if (!res.ok) return {};
  const json = (await res.json()) as {
    code: number;
    result?: Record<string, Record<string, unknown>>;
  };
  if (json.code !== 1 || !json.result) return {};

  const now = Date.now();
  const out: Record<string, GoplusResult> = {};
  for (const [addr, raw] of Object.entries(json.result)) {
    out[addr.toLowerCase()] = { fetchedAt: now, ...parseResult(raw) };
  }
  return out;
}
