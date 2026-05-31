import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// All keys are prefixed "bnkr:" so this project doesn't collide with other
// projects sharing the same Upstash instance.
export const K = {
  launch: (addr: string) => `bnkr:launch:${addr}`,
  /** Sorted set: score = launch timestamp (ms), member = token address */
  launchIndex: "bnkr:launches:index",
  deployer: (addr: string) => `bnkr:deployer:${addr}`,
  /** Hash: field = token address, value = PaidEntry JSON */
  paid: "bnkr:paid",
  /** Set of token addresses already pair-checked by the watcher */
  paidChecked: "bnkr:paid:checked",
  cronLock: "bnkr:cron:lock",
} as const;
