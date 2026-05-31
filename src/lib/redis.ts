import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// All keys prefixed "bnkr:" to avoid collisions with other projects sharing
// this Upstash instance.
export const K = {
  launch: (addr: string) => `bnkr:launch:${addr}`,
  deployer: (addr: string) => `bnkr:deployer:${addr}`,
  /** Hash: field = token address, value = PaidEntry */
  paid: "bnkr:paid",
  cronLock: "bnkr:cron:lock",
} as const;
