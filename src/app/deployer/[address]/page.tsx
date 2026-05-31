import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchDeployerLaunches } from "@/lib/bankr";
import { fmtAge, shortAddr } from "@/lib/format";
import type { BankrLaunch } from "@/lib/types";

export const revalidate = 60;

type Params = { address: string };

export default async function DeployerPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { address } = await params;
  const summary = await fetchDeployerLaunches(address).catch(() => null);
  if (!summary) notFound();

  const deployer = summary.recent[0]?.deployer;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 flex flex-col gap-6">
      <Link href="/" className="text-sm text-zinc-400 hover:text-zinc-100 w-fit">
        ← back to launches
      </Link>

      <div>
        <h1 className="text-xl font-semibold">
          {deployer?.xUsername ? `@${deployer.xUsername}` : shortAddr(address)}
        </h1>
        <p className="text-sm text-zinc-400 font-mono mt-0.5">{address}</p>
        <p className="text-sm text-amber-400/80 mt-1">
          {summary.count}{summary.truncated ? "+" : ""} lifetime launches
          {summary.truncated && " (showing most recent 12)"}
        </p>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900/60 text-zinc-400 uppercase tracking-wide text-xs">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Token</th>
              <th className="text-left px-4 py-2 font-medium">Address</th>
              <th className="text-right px-4 py-2 font-medium">Launched</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {summary.recent.map((launch: BankrLaunch) => (
              <tr key={launch.tokenAddress} className="border-t border-zinc-900 hover:bg-zinc-900/40">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/token/${launch.tokenAddress}`}
                    className="font-medium hover:text-zinc-100"
                  >
                    {launch.tokenName}
                  </Link>
                  <span className="ml-1.5 text-zinc-500 text-xs">{launch.tokenSymbol}</span>
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-zinc-400">
                  {shortAddr(launch.tokenAddress)}
                </td>
                <td className="px-4 py-2.5 text-right text-zinc-400 whitespace-nowrap" suppressHydrationWarning>
                  {fmtAge(launch.timestamp)} ago
                </td>
                <td className="px-4 py-2.5 text-right">
                  {launch.tweetUrl && (
                    <a
                      href={launch.tweetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-zinc-500 hover:text-zinc-100 text-xs"
                    >
                      tweet ↗
                    </a>
                  )}
                </td>
              </tr>
            ))}
            {summary.recent.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">
                  No launches found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
