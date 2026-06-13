export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 flex flex-col gap-6 animate-pulse">
      <div className="h-4 w-32 rounded bg-zinc-800" />

      {/* Token header */}
      <div className="flex items-center gap-4">
        <div className="h-14 w-14 rounded-full bg-zinc-800" />
        <div className="flex flex-col gap-2">
          <div className="h-6 w-48 rounded bg-zinc-800" />
          <div className="h-4 w-72 rounded bg-zinc-900" />
        </div>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3">
            <div className="h-3 w-16 rounded bg-zinc-800" />
            <div className="mt-2 h-7 w-24 rounded bg-zinc-800" />
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 h-80" />

      {/* Trades */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 h-64" />
    </div>
  );
}
