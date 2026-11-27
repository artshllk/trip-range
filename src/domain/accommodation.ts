import { money } from "./budget";
import { planningCostPolicy } from "./money/planning-rates";
import { isCurrency } from "./money/currency";
import {
  ACCOMMODATION_ALLOWANCE_DEFINITION,
  allowanceChargeCoverage,
  type AccommodationChargeCoverage,
} from "./accommodation-charges";
import {
  selectAccommodationQuote,
  type AccommodationEvidence,
  type AccommodationQuote,
  type AccommodationProviderStatus,
  type AccommodationFailure,
} from "./accommodation-evidence";
import type { PlanningCostProvenance } from "./costs/types";
import type { MoneyAmount } from "./money/currency";
import type { Destination, PriceQuote, TripRequest } from "./types";

export const STAY_PLANNING_PERCENT = {
  simple: 70,
  standard: 100,
  comfort: 150,
} as const;
type AccommodationScope = {
  allowanceDefinitionId?: typeof ACCOMMODATION_ALLOWANCE_DEFINITION.id;
  charges: AccommodationChargeCoverage;
  rooms: number;
  paidNights: number;
  providerStatus: AccommodationProviderStatus;
  rejection?: AccommodationFailure;
};
export type AccommodationEstimate = AccommodationScope &
  (
    | {
        kind: "provider-priced";
        quote: PriceQuote;
        evidence: AccommodationQuote;
        nightlyRoomCents?: never;
      }
    | {
        kind: "reviewed-estimate" | "generic-estimate";
        quote: PriceQuote;
        nightlyRoomCents: number;
        evidence?: never;
      }
    | {
        kind: "unavailable";
        quote?: never;
        nightlyRoomCents?: never;
        evidence?: never;
      }
  );
/** Unresearched currency allowance, not a destination average or an inventory quote. */
export function genericStayBasis(request: TripRequest): PriceQuote {
  return {
    amount: money(
      planningCostPolicy[request.budget.currency].stayTwoNights,
      request.budget.currency,
    ),
    confidence: "estimate",
    providerId: "goeksplo-stay-estimate",
    observedAt: null,
    demo: false,
    source: { status: "available" },
    planning: [{ component: "stay", basis: "generic-currency", sourceIds: [] }],
  };
}
/** Legacy StayProvider values are planning bases only; inventory must use scoped evidence. */
export function estimateAccommodation(
  basis: PriceQuote,
  request: TripRequest,
  reviewed?: { roomNight: MoneyAmount; provenance: PlanningCostProvenance },
  inventory?: {
    destination: Destination;
    evidence?: AccommodationEvidence;
    now: number;
  },
): AccommodationEstimate {
  const selected = inventory
    ? selectAccommodationQuote(
        inventory.evidence,
        inventory.destination,
        request,
        inventory.now,
      )
    : undefined;
  const scope = {
    charges: allowanceChargeCoverage(inventory?.destination),
    rooms: Math.ceil((request.party.adults + request.party.children) / 2),
    paidNights: request.nights,
    providerStatus:
      selected?.status ?? ("disabled" as AccommodationProviderStatus),
    rejection: selected?.rejection,
  };
  if (
    !isCurrency(request.budget.currency) ||
    !Number.isSafeInteger(request.nights) ||
    request.nights < 1 ||
    request.nights > 14 ||
    !Number.isSafeInteger(request.party.adults) ||
    request.party.adults < 1 ||
    request.party.adults > 12 ||
    !Number.isSafeInteger(request.party.children) ||
    request.party.children < 0 ||
    request.party.children > 10 ||
    !Object.prototype.hasOwnProperty.call(
      STAY_PLANNING_PERCENT,
      request.preferences.stayLevel,
    )
  )
    return { ...scope, kind: "unavailable" };
  if (selected?.quote) {
    const q = selected.quote;
    return {
      ...scope,
      kind: "provider-priced",
      rooms: q.allocation.rooms,
      evidence: q,
      charges: q.charges.conditional
        ? { status: "unresolved", reason: "unresolved-provider-condition" }
        : { status: "included", basis: "provider-total" },
      quote: {
        amount: { ...q.charges.total! },
        confidence: "recent",
        source: { status: "available" },
        providerId: q.provider,
        observedAt: q.observedAt,
        demo: false,
        planning: [
          { component: "stay", basis: "provider-availability", sourceIds: [] },
        ],
      },
    };
  }
  const valid = (a?: MoneyAmount) =>
    !!a &&
    a.currency === request.budget.currency &&
    Number.isSafeInteger(a.cents) &&
    a.cents > 0 &&
    a.cents <= 1_000_000;
  // A reviewed standard-room allowance remains a planning basis, even when scaled for a tier.
  const review =
    reviewed &&
    valid(reviewed.roomNight) &&
    reviewed.provenance.basis === "reviewed-destination"
      ? reviewed
      : undefined;
  const fallback =
    valid(basis.amount) &&
    basis.source.status !== "unavailable" &&
    basis.source.status !== "stale"
      ? basis
      : genericStayBasis(request);
  const nightlyRoomCents = Math.round(
    ((review ? review.roomNight.cents : fallback.amount.cents / 2) *
      STAY_PLANNING_PERCENT[request.preferences.stayLevel]) /
      100,
  );
  const cents = nightlyRoomCents * scope.paidNights * scope.rooms;
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 100_000_000)
    return { ...scope, kind: "unavailable" };
  return {
    ...scope,
    charges:
      selected?.rejection === "charges-unknown"
        ? { status: "unresolved", reason: "unknown-mandatory-charges" }
        : scope.charges,
    kind: review ? "reviewed-estimate" : "generic-estimate",
    allowanceDefinitionId: ACCOMMODATION_ALLOWANCE_DEFINITION.id,
    nightlyRoomCents,
    quote: {
      ...fallback,
      ...(review && fallback.roomPanel ? { roomPanel: undefined } : {}), // A different room basis cannot inherit the panel.
      planning: review
        ? [review.provenance]
        : (fallback.planning ?? [
            { component: "stay", basis: "curated-legacy", sourceIds: [] },
          ]),
      amount: money(cents, request.budget.currency),
      confidence: "estimate",
      providerId: "goeksplo-stay-estimate",
      observedAt: null,
    },
  };
}
