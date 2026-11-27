import "server-only";

/**
 * A short-lived, in-process cache for reads every visitor shares (owner decision,
 * 25 November 2026: abuse controls, option A). Keys must describe shared data
 * only, never anything about a visitor: the fare store is keyed by origin and date
 * window. Concurrent misses share one load (single flight). A failed or empty
 * load (undefined) is never cached, so an outage is retried on the next request.
 * The map is bounded; the oldest entry is evicted first.
 */
export function sharedReadCache<T>(options: {
  ttlMs: number;
  maxEntries: number;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const entries = new Map<string, { until: number; value: T }>();
  const inFlight = new Map<string, Promise<T | undefined>>();
  return async function read(
    key: string,
    load: () => Promise<T | undefined>,
  ): Promise<T | undefined> {
    const hit = entries.get(key);
    if (hit && hit.until > now()) return hit.value;
    if (hit) entries.delete(key);
    const pending = inFlight.get(key);
    if (pending) return pending;
    const run = (async () => {
      try {
        const value = await load();
        if (value !== undefined) {
          entries.set(key, { until: now() + options.ttlMs, value });
          while (entries.size > options.maxEntries)
            entries.delete(entries.keys().next().value!);
        }
        return value;
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, run);
    return run;
  };
}
