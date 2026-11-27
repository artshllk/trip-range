import "server-only";
import { createHash } from "node:crypto";
import { unstable_cache } from "next/cache";
import type {
  FlightAffiliateProvider,
  AccommodationAffiliateProvider,
} from "../contracts";
import type {
  AffiliateResult,
  FlightHandoff,
  AffiliatePlacement,
} from "../../domain/affiliate";
import { travelpayoutsEnvironment } from "./environment";
import {
  createAviasalesAffiliate,
  aviasalesSearchUrl,
} from "./aviasales-affiliate";
import { guardAffiliate } from "./affiliate-cache";

class AffiliateFailure extends Error {
  constructor(
    readonly result: Extract<AffiliateResult, { status: "unavailable" }>,
  ) {
    super("Affiliate link unavailable");
  }
}
let configured:
  | { identity: string; flight: FlightAffiliateProvider }
  | undefined;
export function affiliateProviders(): {
  flight: FlightAffiliateProvider;
  accommodation?: AccommodationAffiliateProvider;
} {
  const env = travelpayoutsEnvironment();
  const identity = createHash("sha256")
    .update(JSON.stringify(env))
    .digest("hex");
  if (configured?.identity === identity) return { flight: configured.flight };
  const provider = guardAffiliate(createAviasalesAffiliate(env));
  // Cache only converted short links; no raw response, headers or credentials enter the cache value.
  const cached = unstable_cache(
    async (route: FlightHandoff, placement: AffiliatePlacement) => {
      const result = await provider.createLink(route, placement);
      // Failures are never cached; the reason travels with the error.
      if (result.status !== "available") throw new AffiliateFailure(result);
      return result;
    },
    ["flight-affiliate-v1", identity],
    { revalidate: 86400 },
  );
  const flight: FlightAffiliateProvider = {
    async createLink(route, placement): Promise<AffiliateResult> {
      if (!aviasalesSearchUrl(route, new Date().toISOString().slice(0, 10)))
        return { status: "unavailable", reason: "unsupported" };
      try {
        return await cached(route, placement);
      } catch (error) {
        return error instanceof AffiliateFailure
          ? error.result
          : { status: "unavailable", reason: "provider" };
      }
    },
  };
  configured = { identity, flight };
  return { flight };
}
