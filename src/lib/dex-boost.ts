export type BoostTier = {
  multiplier: number;
  usdCost: number;
  durationHours: number;
};

export const BOOST_TIERS: BoostTier[] = [
  { multiplier: 10, usdCost: 99, durationHours: 12 },
  { multiplier: 30, usdCost: 249, durationHours: 12 },
  { multiplier: 50, usdCost: 399, durationHours: 12 },
  { multiplier: 100, usdCost: 899, durationHours: 24 },
  { multiplier: 500, usdCost: 3999, durationHours: 24 },
];

export function boostTierFor(multiplier: number): BoostTier | undefined {
  return BOOST_TIERS.find((t) => t.multiplier === multiplier);
}

/**
 * Total boost amount may be a sum of several purchased tiers
 * (e.g. 10 + 30 = 40). Estimate the lifetime USD spend by
 * greedily decomposing the total into tier multipliers.
 */
export function estimateBoostSpend(totalMultiplier: number): number {
  let remaining = totalMultiplier;
  let usd = 0;
  const tiers = [...BOOST_TIERS].sort((a, b) => b.multiplier - a.multiplier);
  for (const t of tiers) {
    while (remaining >= t.multiplier) {
      remaining -= t.multiplier;
      usd += t.usdCost;
    }
  }
  return usd;
}

/** Color class for the boost tier — escalates with size. */
export function boostColorClass(multiplier: number): string {
  if (multiplier >= 500) return "text-amber-300";
  if (multiplier >= 100) return "text-yellow-300";
  if (multiplier >= 30) return "text-yellow-400";
  return "text-yellow-500";
}
