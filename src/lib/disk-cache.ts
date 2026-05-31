import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Map subclass that loads its initial state from a JSON file and writes
 * back (debounced) on every mutation. Survives Node process restarts.
 *
 * Designed for small caches (thousands of entries max). Not safe for
 * concurrent processes writing to the same path.
 */
export class DiskBackedMap<V> extends Map<string, V> {
  private writeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly path: string,
    private readonly debounceMs: number = 1000,
  ) {
    super();
    try {
      const raw = readFileSync(path, "utf8");
      const obj = JSON.parse(raw) as Record<string, V>;
      for (const [k, v] of Object.entries(obj)) super.set(k, v);
    } catch {
      // No file yet, or unreadable / corrupt — start empty.
    }
    // Flush pending writes on process exit so debounced updates aren't lost
    // when the dev server is killed mid-debounce.
    const flush = () => this.flushNow();
    process.on("beforeExit", flush);
    process.on("SIGINT", flush);
    process.on("SIGTERM", flush);
  }

  /** Force-flush any pending debounced write synchronously. */
  flushNow() {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    this.flush();
  }

  override set(key: string, value: V): this {
    super.set(key, value);
    this.scheduleWrite();
    return this;
  }

  override delete(key: string): boolean {
    const removed = super.delete(key);
    if (removed) this.scheduleWrite();
    return removed;
  }

  override clear(): void {
    super.clear();
    this.scheduleWrite();
  }

  private scheduleWrite() {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.flush();
    }, this.debounceMs);
  }

  private flush() {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const obj: Record<string, V> = {};
      for (const [k, v] of this.entries()) obj[k] = v;
      writeFileSync(this.path, JSON.stringify(obj));
    } catch (err) {
      console.error(`[disk-cache] write failed for ${this.path}:`, err);
    }
  }
}

/**
 * Singleton helper for module-level caches that survive HMR in dev.
 * Stores instances on globalThis so re-imports return the same Map.
 */
export function getOrCreateDiskMap<V>(
  globalKey: string,
  path: string,
): DiskBackedMap<V> {
  const g = globalThis as unknown as Record<string, DiskBackedMap<V> | undefined>;
  let existing = g[globalKey];
  if (!existing) {
    existing = new DiskBackedMap<V>(path);
    g[globalKey] = existing;
  }
  return existing;
}
