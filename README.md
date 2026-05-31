# bnkrscreener

A live screener for tokens launched via [Bankr](https://bankr.bot) on Base — like [DexScreener](https://dexscreener.com), but built specifically for Bankr deployments, with signals DexScreener doesn't surface (deployer lifetime launch count, paid DEX status, deployer trade markers, cross-launch grouping).

> **Status**: early; useful day-to-day but unpolished. Deploys to Vercel.

## What it shows

**Home page** — the live feed of recent Bankr launches with:

- Sortable table: age · price · 24h % · volume · liquidity · market cap
- Search across token name, symbol, address, deployer
- **👑 lifetime launch count** next to each deployer (colored — zinc 2–5, amber 6–20, rose 21+)
- **⚡ Nx boost** badge when a token has a currently-active DexScreener boost
- **💎 profile** badge when a team paid for DexScreener's Enhanced Token Info
- **Filters**: "Traded only" (hides untraded spam), "Paid DEX" (only boosted/profiled tokens)
- **Cross-launch grouping**: if the same deployer launches the same token name 3+ times, collapses to one row with `3× attempts` badge
- **Live indicator**: subtle dot pulses on each 3s poll; new paid tokens flash cyan when first detected
- Auto-refreshes every 3s

**Token detail page** (`/token/[address]`):

- Native TradingView Lightweight Charts candlestick chart (replaces the DexScreener iframe — own UI, own data)
- 1m / 5m / 15m / 1h / 4h / 1d timeframes
- Live trades panel — DEPLOYER/FEE wallet badges, X handles for known wallets, Basescan links
- Deployer trades rendered as ↑/↓ markers directly on the chart
- Deployer lifetime launch count, paid status, social/site/explorer links

## Stack

- **Next.js 16** (App Router, Turbopack) + React 19
- **TypeScript** + **Tailwind v4**
- **TradingView Lightweight Charts v5** for the price chart
- No DB — disk-persisted in-memory caches in `/tmp/bankr-screener/`
- Deployed on **Vercel** (Fluid Compute, Node.js)

## Data sources

| Source | What we use it for | Notes |
|---|---|---|
| [Bankr API](https://api.bankr.bot) (`/token-launches*`) | Live launch feed, deployer histories, per-token metadata | **Undocumented internal endpoints** — IP-ban risk if abused. We use `createLimit(2)` and aggressive disk caching to stay polite. |
| [DexScreener API](https://docs.dexscreener.com/api/reference) | Price, volume, liquidity (`/latest/dex/tokens`); paid boost/profile signals (`/orders/v1`, `/token-boosts/*`, `/token-profiles/*`); authoritative `pair.boosts.active` for current boost status | Free, no key. ~300 req/min cap — well below our usage. |
| [GeckoTerminal API](https://www.geckoterminal.com/dex-api) | OHLCV candles, recent trades for the per-token chart | Free, no key, ~30 req/min. Coverage of Uniswap V4 / Doppler pools is partial. |
| Base mainnet RPC | Not used yet — Phase 3 will index Doppler events directly | Public RPC: `https://mainnet.base.org` |

## Local development

```bash
npm install
npm run dev          # starts on :3000
# or: npm run dev -- -p 3001
```

Then open <http://localhost:3001>.

**First request is slow (~3–5s)** while the watcher backfills:
- Pulls the 50 most recent Bankr launches
- Paginates each distinct deployer's full launch history (~30 deployers × ~3 pages each)
- Disk caches everything to `/tmp/bankr-screener/*.json`

Subsequent requests are near-instant (`/api/launches` typically <10ms).

### Editing the paid watcher

`src/lib/paid-watcher.ts` starts a `setInterval` on first import. Next.js HMR re-imports modules on edit but doesn't restart the existing interval, so changes to the watcher's poll logic won't take effect until you restart the dev server:

```bash
pkill -f "next dev" && npm run dev -- -p 3001
```

Edits to non-watcher files (`enrich.ts`, components, etc.) hot-reload normally.

## Architecture highlights

```
┌────────────────────────────────────────────────────────────┐
│  Browser                                                   │
│  └─ launches-table.tsx polls /api/launches every 3s        │
└────────────────────────────────────────────────────────────┘
              ↓ JSON (typically <10ms, all in-memory)
┌────────────────────────────────────────────────────────────┐
│  /api/launches → enrich.ts → reads in-memory caches        │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Background singletons (started on first import)      │  │
│  │                                                      │  │
│  │ • bankr.ts: launchCache, deployerCache               │  │
│  │   ↳ disk-persisted to /tmp/bankr-screener/*.json     │  │
│  │   ↳ bankrLimit(2) caps parallel Bankr calls          │  │
│  │                                                      │  │
│  │ • paid-watcher.ts: setInterval(10s)                  │  │
│  │   ↳ polls DexScreener boost/profile feeds            │  │
│  │   ↳ every 60s, sweeps all known Bankr launches via   │  │
│  │     pair.boosts.active (authoritative source)        │  │
│  │   ↳ disk-persisted state with firstPaidAt timestamps │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
              ↓ throttled, cached, bounded
┌────────────────────────────────────────────────────────────┐
│  Bankr API · DexScreener API · GeckoTerminal API           │
└────────────────────────────────────────────────────────────┘
```

Key file map:

- `src/lib/bankr.ts` — Bankr fetcher + disk-backed `launchCache` / `deployerCache`
- `src/lib/dexscreener.ts` — DexScreener pair + paid signals
- `src/lib/geckoterminal.ts` — OHLCV + trades for the chart
- `src/lib/paid-watcher.ts` — singleton paid-detection poller with deployer-history backfill
- `src/lib/disk-cache.ts` — `DiskBackedMap<V>` (Map subclass with debounced JSON writes)
- `src/lib/enrich.ts` — composes the above into the API response
- `src/lib/limit.ts` — `createLimit(N)` concurrency-bounded queue
- `src/lib/dex-boost.ts` — DexScreener boost tier → USD cost mapping
- `src/components/launches-table.tsx` — home page table
- `src/components/price-chart.tsx` — Lightweight Charts wrapper with deployer trade markers
- `src/components/trades-table.tsx` — live trades feed with wallet tagging

## Deploy on Vercel

The app deploys as-is and works for active traffic. Two pieces degrade on serverless that don't matter today but will once you need them:

1. **`/tmp/` is per-instance and ephemeral** — disk caches don't survive instance recycle, and different concurrent instances have different state. Fix: replace `DiskBackedMap` with an Upstash Redis backend (`@upstash/redis`, free tier sufficient).
2. **`paid-watcher` setInterval dies when the function instance idles out** — meaning the watcher silently stops detecting new paid tokens during low-traffic windows. Fix: replace with a Vercel Cron job (`* * * * *` minimum cadence) writing to the same Upstash Redis.

For sub-minute detection latency in production, run the watcher on a separate always-on host (the [DigitalOcean droplet](https://github.com/BankrBot/skills) the original author uses) and have it push to Upstash; the Vercel app just reads.

## What's deferred / known caveats

- **Bankr API endpoints are undocumented** — `/token-launches*` is an internal frontend endpoint, not a public API. Cloudflare aggressively blocks unauthenticated bursts. Getting a Bankr API key (`X-API-Key`, sign up at [bankr.bot/api](https://bankr.bot/api)) would put us in the authenticated rate-limit tier; not yet wired.
- **GeckoTerminal has ~30–60s indexing lag** on Doppler / Uniswap V4 pools, sometimes longer. For the chart it's acceptable; for sub-second trade tracking you'd want your own indexer.
- **DexScreener boost detection** is best-effort — their global `/token-boosts/latest/v1` only holds the most recent 30 globally, so we backfill by sweeping all known Bankr launches' pairs every 60s for `boosts.active > 0`. New launches discovered via the live feed enter the sweep set on next backfill.
- **No DB** — all state is in-memory + `/tmp/` JSON. Sufficient for the current scale (thousands of tokens), but doesn't share across Vercel function instances.

## Roadmap

- **Done**: native chart + trades, deployer count, paid DEX detection with flash, cross-launch grouping, wallet labels on trades, deployer trade markers on chart
- **Next**: deployer detail page (`/deployer/[address]`), Upstash Redis backend for Vercel deploy, Bankr API key support
- **Eventually**: own Doppler indexer on a long-running host, sniper detection across launches, X/Farcaster context per known wallet
