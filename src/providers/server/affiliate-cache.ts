import "server-only";
import type { FlightAffiliateProvider } from "../contracts";
import type { AffiliateResult } from "../../domain/affiliate";

/** Single-instance sliding-window quota and bounded click deduplication. No render-time calls. */
export function guardAffiliate(
  provider: FlightAffiliateProvider,
  now = Date.now,
  limit = 60,
): FlightAffiliateProvider {
  const starts: number[] = [];
  let blockedUntil = 0;
  const entries = new Map<
    string,
    { expires: number; result: Promise<AffiliateResult> }
  >();
  return {
    async createLink(route, placement) {
      const time = now();
      const key = JSON.stringify([route, placement]);
      const old = entries.get(key);
      if (old && old.expires > time) return old.result;
      while (starts.length && starts[0] <= time - 60000) starts.shift();
      if (time < blockedUntil || starts.length >= limit)
        return { status: "unavailable", reason: "rate-limit" };
      starts.push(time);
      for (const [key, entry] of entries)
        if (entry.expires <= time) entries.delete(key);
      if (entries.size >= 256) entries.delete(entries.keys().next().value!);
      const entry = {
        expires: time + 60000,
        result: Promise.resolve<AffiliateResult>({
          status: "unavailable",
          reason: "provider",
        }),
      };
      entry.result = provider
        .createLink(route, placement)
        .catch(
          (): AffiliateResult => ({
            status: "unavailable",
            reason: "provider",
          }),
        )
        .then((result) => {
          entry.expires =
            now() + (result.status === "available" ? 86400000 : 60000);
          if (result.status === "unavailable" && result.reason === "rate-limit")
            blockedUntil = now() + 60000;
          return result;
        });
      entries.set(key, entry);
      return entry.result;
    },
  };
}
