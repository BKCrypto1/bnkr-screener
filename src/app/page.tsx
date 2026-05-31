import { getEnrichedLaunchesResult } from "@/lib/enrich";
import { LaunchesTable } from "@/components/launches-table";

export const revalidate = 3;

export default async function Home() {
  const { launches, extraPaid } = await getEnrichedLaunchesResult();
  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Latest Bankr launches</h1>
        <p className="text-xs text-zinc-500">
          Top {launches.length} most recent · auto-refreshes every 3s
        </p>
      </div>
      <LaunchesTable initial={launches} initialExtraPaid={extraPaid} />
    </div>
  );
}
