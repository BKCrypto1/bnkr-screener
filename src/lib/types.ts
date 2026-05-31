export type BankrLaunch = {
  activityId: string;
  status: string;
  launchType: string;
  tokenName: string;
  tokenSymbol: string;
  chain: string;
  imageUri?: string;
  tokenAddress: string;
  poolId?: string;
  txHash?: string;
  deployer: {
    walletAddress: string;
    xUsername?: string;
    xProfileImageUrl?: string;
  };
  feeRecipient?: {
    walletAddress: string;
    xUsername?: string;
    xProfileImageUrl?: string;
  };
  tweetUrl?: string;
  websiteUrl?: string;
  metadataUri?: string;
  timestamp: number;
};

export type DexPair = {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd?: string;
  priceNative?: string;
  txns?: { h24?: { buys: number; sells: number } };
  volume?: { h24?: number; h6?: number; h1?: number; m5?: number };
  priceChange?: { h24?: number; h6?: number; h1?: number; m5?: number };
  liquidity?: { usd?: number; base?: number; quote?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  boosts?: { active?: number };
  info?: {
    imageUrl?: string;
    header?: string;
    openGraph?: string;
    websites?: Array<{ url: string; label?: string }>;
    socials?: Array<{ url: string; type?: string }>;
  };
};

export type DexPaidStatus = {
  boosted: boolean;
  boostAmount: number;
  totalBoostAmount: number;
  hasProfile: boolean;
  orderTypes: string[];
};

export type GoplusHolder = {
  address: string;
  percent: number; // 0–1 decimal
};

export type GoplusResult = {
  fetchedAt: number;
  isInDex: boolean;
  isHoneypot: boolean;
  whaleCount: number;  // EOA holders > 5%
  largeCount: number;  // EOA holders 3–5%
  mediumCount: number; // EOA holders 1–3%
  topHolders: GoplusHolder[];
};

export type EnrichedLaunch = BankrLaunch & {
  pair?: DexPair;
  deployerLaunchCount?: number;
  dexPaid?: DexPaidStatus;
  firstPaidAt?: number;
  lastBoostedAt?: number;
  lastProfileAt?: number;
  goplus?: GoplusResult;
};
