import { isCalendarDate, nightsBetween } from "./dates";
import { observationTimestamp } from "./fare-evidence";
import type { Destination, MoneyAmount, StayLevel, TripRequest } from "./types";

/** Proposed V1 policy, not a provider promise. No production inventory adapter is active. */
export const STAY_QUOTE_FRESHNESS_MS = 5 * 60_000;
export const MAX_STAY_CANDIDATES = 20;
export type AccommodationQuote = {
  provider: string;
  propertyId: string;
  productId: string;
  location: {
    destinationId: string;
    countryCode: string;
    providerLocationId: string;
    binding: "exact";
  };
  checkin: string;
  checkout: string;
  adults: number;
  children: 0;
  childrenPolicy: "adult-only";
  allocation: { adults: number; rooms: number; basis: "provider" };
  booker: {
    country: string;
    platform: "desktop" | "mobile";
    source: "explicit";
  };
  level: StayLevel;
  propertyType: "hotel";
  privateRoom: true;
  stars: number;
  reviewScore: number;
  reviewCount: number;
  publicRate: true;
  cancellation: "non-refundable" | "refundable" | "unknown";
  meals: "none" | "breakfast" | "other" | "unknown";
  charges: {
    base: MoneyAmount;
    includedMandatory: MoneyAmount;
    excludedMandatory: MoneyAmount;
    /** Already contains base + all known mandatory charges. Never add them again. */
    total: MoneyAmount | null;
    unknownMandatory: boolean;
    conditional: boolean;
  };
  observedAt: string;
  retrievedAt: string;
};
export type AccommodationFailure =
  | "disabled"
  | "timeout"
  | "authentication"
  | "rate-limit"
  | "unavailable"
  | "malformed"
  | "currency-mismatch"
  | "scope-mismatch"
  | "charges-unknown"
  | "stale";
export type AccommodationEvidence =
  | { status: "available"; quotes: AccommodationQuote[] }
  | { status: "empty" }
  | { status: "stale" }
  | { status: "unavailable"; reason: AccommodationFailure };
export type AccommodationProviderStatus =
  | AccommodationEvidence["status"]
  | "disabled";

const tiers = {
  simple: { stars: [2, 3], score: 7 },
  standard: { stars: [3, 4], score: 8 },
  comfort: { stars: [4, 5], score: 8 },
} satisfies Record<StayLevel, { stars: number[]; score: number }>;
const safeId = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z0-9:_-]{1,100}$/.test(value);
/** No provider URLs, tokens, names or free text belong in normalized stay evidence. */
export function accommodationQuoteRejection(
  q: AccommodationQuote,
  destination: Destination,
  request: TripRequest,
  now: number,
): AccommodationFailure | undefined {
  try {
    if (
      !safeId(q.provider) ||
      !safeId(q.propertyId) ||
      !safeId(q.productId) ||
      !safeId(q.location.providerLocationId)
    )
      return "malformed";
    if (
      q.location.binding !== "exact" ||
      q.location.destinationId !== destination.id ||
      q.location.countryCode !== destination.countryCode ||
      !isCalendarDate(q.checkin) ||
      !isCalendarDate(q.checkout) ||
      q.checkin !== request.dates.startDate ||
      q.checkout !== request.dates.endDate ||
      nightsBetween(q.checkin, q.checkout) !== request.nights ||
      q.adults !== request.party.adults ||
      request.party.children !== 0 ||
      q.children !== 0 ||
      q.childrenPolicy !== "adult-only" ||
      q.level !== request.preferences.stayLevel ||
      q.allocation.basis !== "provider" ||
      q.allocation.adults !== q.adults ||
      !Number.isSafeInteger(q.allocation.rooms) ||
      q.allocation.rooms < 1 ||
      q.allocation.rooms > q.adults ||
      q.booker.source !== "explicit" ||
      !/^[A-Z]{2}$/.test(q.booker.country) ||
      !["desktop", "mobile"].includes(q.booker.platform)
    )
      return "scope-mismatch";
    const tier = tiers[q.level];
    if (
      !tier ||
      q.propertyType !== "hotel" ||
      q.privateRoom !== true ||
      q.publicRate !== true ||
      !tier.stars.includes(q.stars) ||
      !Number.isFinite(q.reviewScore) ||
      q.reviewScore < tier.score ||
      q.reviewScore > 10 ||
      !Number.isSafeInteger(q.reviewCount) ||
      q.reviewCount < 20 ||
      !["non-refundable", "refundable", "unknown"].includes(q.cancellation) ||
      !["none", "breakfast", "other", "unknown"].includes(q.meals)
    )
      return "scope-mismatch";
    const amounts = [
      q.charges.base,
      q.charges.includedMandatory,
      q.charges.excludedMandatory,
      q.charges.total,
    ];
    if (amounts.some((a) => a && a.currency !== request.budget.currency))
      return "currency-mismatch";
    if (
      q.charges.unknownMandatory !== false ||
      typeof q.charges.conditional !== "boolean" ||
      amounts.some(
        (a) =>
          !a ||
          !Number.isSafeInteger(a.cents) ||
          a.cents < 0 ||
          a.cents > 100_000_000,
      ) ||
      !q.charges.total ||
      q.charges.total.cents <= 0 ||
      q.charges.total.cents !==
        q.charges.base.cents +
          q.charges.includedMandatory.cents +
          q.charges.excludedMandatory.cents
    )
      return "charges-unknown";
    const observed = observationTimestamp(q.observedAt),
      retrieved = observationTimestamp(q.retrievedAt);
    if (
      !observed ||
      !retrieved ||
      !Number.isFinite(now) ||
      Date.parse(observed) > Date.parse(retrieved) ||
      Date.parse(retrieved) > now ||
      now - Date.parse(observed) > STAY_QUOTE_FRESHNESS_MS
    )
      return "stale";
  } catch {
    return "malformed";
  }
}

/** Lowest total among explicitly eligible products, never the cheapest unfiltered property. */
export function selectAccommodationQuote(
  evidence: AccommodationEvidence | undefined,
  destination: Destination,
  request: TripRequest,
  now: number,
): {
  status: AccommodationProviderStatus;
  quote: AccommodationQuote | undefined;
  rejection?: AccommodationFailure;
} {
  const status: AccommodationProviderStatus = evidence?.status ?? "disabled";
  if (evidence?.status !== "available")
    return {
      status,
      quote: undefined,
      rejection: evidence?.status === "unavailable" ? evidence.reason : undefined,
    };
  if (
    !Array.isArray(evidence.quotes) ||
    evidence.quotes.length > MAX_STAY_CANDIDATES
  )
    return {
      status: "unavailable" as const,
      quote: undefined,
      rejection: "malformed" as const,
    };
  let rejection: AccommodationFailure | undefined;
  const eligible = evidence.quotes.filter((q) => {
    const reason = accommodationQuoteRejection(q, destination, request, now);
    // A fallback must retain unknown charges even if another candidate failed first.
    if (reason === "charges-unknown") rejection = reason;
    else if (reason) rejection ??= reason;
    return !reason;
  });
  eligible.sort(
    (a, b) =>
      a.charges.total!.cents - b.charges.total!.cents ||
      a.provider.localeCompare(b.provider) ||
      a.propertyId.localeCompare(b.propertyId) ||
      a.productId.localeCompare(b.productId),
  );
  return {
    status,
    quote: eligible[0],
    rejection: eligible.length ? undefined : rejection,
  };
}
