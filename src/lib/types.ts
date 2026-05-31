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
};

export type DexPaidStatus = {
  boosted: boolean;
  boostAmount: number;
  totalBoostAmount: number;
  hasProfile: boolean;
  orderTypes: string[];
};

export type EnrichedLaunch = BankrLaunch & {
  pair?: DexPair;
  deployerLaunchCount?: number;
  dexPaid?: DexPaidStatus;
  /** Timestamp (ms) when this token was first observed as paid by the watcher */
  firstPaidAt?: number;
};
