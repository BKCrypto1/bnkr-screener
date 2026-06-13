export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 flex flex-col gap-6 animate-pulse">
      <div className="h-4 w-32 rounded bg-zinc-800" />

      <div className="flex flex-col gap-2">
        <div className="h-6 w-40 rounded bg-zinc-800" />
        <div className="h-4 w-80 rounded bg-zinc-900" />
        <div className="h-4 w-44 rounded bg-zinc-900" />
      </div>

      {/* Launches table */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-zinc-900 last:border-0">
            <div className="h-8 w-8 rounded-full bg-zinc-800" />
            <div className="h-4 w-32 rounded bg-zinc-800" />
            <div className="ml-auto h-4 w-16 rounded bg-zinc-900" />
          </div>
        ))}
      </div>
    </div>
  );
}
