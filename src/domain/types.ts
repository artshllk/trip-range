import type { PlanningCostProvenance, CostIntegrity } from "./costs/types";
import type { FlightPricingState } from "./flight-pricing";
import type { DepartureAirportCandidate } from "./airports";
import type { AccommodationEstimate } from "./accommodation";
import type { TravelDates, DatePreset } from "./dates";
export type LocalizedText = { en: string; sq: string };
import type { MoneyAmount, MoneyDelta } from "./money/currency";
export type { MoneyAmount, MoneyDelta } from "./money/currency";
// No "live" tier: the Aviasales Data API serves cached fares and we cannot query airlines.
export type PriceConfidence = "recent" | "estimate";
export type TripFit = "comfortable" | "close" | "over";
export type CostCategory =
  | "transport"
  | "stay"
  | "local"
  | "food"
  | "activities"
  | "airportTransfer"
  | "gatewayTransfer"
  | "baggage"
  | "lodgingTax";
export type TravelerParty = { adults: number; children: number };
export type TripStyle = "nature" | "beach" | "city" | "quiet";
export type StayLevel = "simple" | "standard" | "comfort";
export type TripPreference = {
  nearbyAirports: boolean;
  car: boolean;
  luggage: boolean;
  familyStay: boolean;
  stayLevel: StayLevel;
};
export type TravelLocation = {
  id: string;
  name: string;
  countryCode: string;
  countryName: LocalizedText;
  type: "city" | "airport" | "country";
  cityCode?: string;
  airportIata?: string;
  coordinates?: { latitude: number; longitude: number };
  iataCodes?: string[];
};
export type TravelScope = "anywhere" | "domestic";
export type SourceStatus =
  | { status: "available" }
  | { status: "fallback" | "stale" | "unavailable"; reason: string };
export type TripRequest = {
  budget: MoneyAmount;
  party: TravelerParty;
  originId: string;
  origin?: TravelLocation;
  destination?: TravelLocation;
  noFlight?: boolean;
  departureAirport?: string;
  /** Detail restoration hint only; revalidated against the destination's reviewed access. */
  arrivalEntry?: { destinationId: string; code: string };
  scope: TravelScope;
  when: DatePreset | "custom";
  dates: TravelDates;
  nights: number;
  flexible: boolean;
  styles: TripStyle[];
  preferences: TripPreference;
};
export type ImageAsset = {
  src: string;
  source: "design-reference" | "local" | "provider";
  sourceId: string;
  author: string | null;
  attribution: string;
  license: string | null;
  destinationId: string | null;
  verification: "unverified" | "verified" | "illustrative";
  photoUrl?: string;
  authorUrl?: string;
  alt?: string;
  localizedAlt?: LocalizedText;
  /** Pre-optimized, same-photo local rasters; never remote/provider URL templates. */
  localVariants?: { src: string; width: number; height: number }[];
  focalPoint?: { x: number; y: number };
  sourceStatus?: SourceStatus;
};
export type Destination = {
  cityCode?: string;
  metadataSource?: string;
  /** Unknown specialty styles remain false; normalized city identity alone supports city. */
  stylesKnown?: boolean;
  id: string;
  name: LocalizedText;
  country: LocalizedText;
  styles: TripStyle[];
  countryCode: string;
  requiresFlight: boolean;
  iataCodes?: string[];
  imageQuery?: string;
  estimatedStay?: MoneyAmount;
  coordinates?: TravelLocation["coordinates"];
  travelHours: number;
  image?: ImageAsset;
  heroImage?: ImageAsset;
  fallbackImage?: ImageAsset;
  why: LocalizedText;
};
export type PriceQuote = {
  /** Reviewed panel provenance bound to this room-rate basis, never a raw research import. */
  roomPanel?: import("./panel-lodging-tax").PanelEvidence;
  planning?: readonly PlanningCostProvenance[];
  amount: MoneyAmount;
  confidence: PriceConfidence;
  source: SourceStatus;
  providerId: string;
  observedAt: string | null;
  /** When we fetched it from the provider. Distinct from observedAt, the provider's own time. */
  fetchedAt?: string | null;
  /** Provider `actual` flag for the offer, when the observation endpoint supplied one. */
  providerActual?: boolean;
  /** Endpoint that supplied observedAt (found_at), e.g. "aviasales/v3/get_latest_prices". */
  observationEndpoint?: string;
  demo: boolean;
};
export type CostItem = PriceQuote & { category: CostCategory };
export type BudgetBreakdown = {
  estimatedSpend: MoneyAmount;
  safetyBuffer: MoneyAmount;
  budgetNeeded: MoneyAmount;
  remainingAfterReserve: MoneyAmount;
  utilization: number;
  fit: TripFit;
  overBudget: MoneyAmount;
  priceChangeSpendDelta: MoneyDelta;
  /**
   * Present when the fit test used an upper bound above budgetNeeded: the high end
   * of the stay's planning band and any possible lodging tax, each with its reserve.
   */
  upperBoundNeeded?: MoneyAmount;
};
export type FlightQuoteScope = {
  unit: "per-traveller" | "party";
  journey: "return" | "one-way";
  dates: TravelDates;
  party?: TravelerParty;
  fees: "provider-unspecified" | "included";
};
export type FlightDiscoveryFare = {
  originCode: string;
  /** Actual airport is separate from the provider query/city identity. */
  originAirport?: string;
  destinationCode: string;
  destinationAirport?: string;
  price: PriceQuote;
  scope: FlightQuoteScope;
  transfers?: number;
  airline?: string;
  retrievedAt: string | null;
};
export type DiscoveryDiagnostic = {
  code:
    | "unknown-destination"
    | "schema-invalid"
    | "currency-from-request"
    | "sample-limit-reached"
    | "date-unmatched"
    | "malformed-row"
    | "date-mismatch"
    | "scope-mismatch"
    | "provider-empty"
    | "provider-failed"
    | "stale-fare"
    | "observation-unconfirmed"
    | "reference-only"
    | "currency-rejected"
    | "targeted-restoration"
    | "gateway-restoration";
  count: number;
};
export type FlightDiscovery = {
  fares: FlightDiscoveryFare[];
  diagnostics: DiscoveryDiagnostic[];
};
export type TransportQuote = {
  departure?: DepartureAirportCandidate;
  arrival?: import("./destination-access/types").ArrivalAccess;
  directArrival?: import("./destination-access/types").DirectArrival;
} & (
  | { mode: "road"; price: PriceQuote; flightPricing?: never }
  | { mode: "flight"; flightPricing: FlightPricingState; price?: never }
);
/** Road per vehicle (5 seats); flights carry scoped evidence; stay per room for two nights. */
export type TripTemplate = {
  costReferenceDate?: string;
  /** Scoped inventory only; absent in production until partner access is approved. */
  accommodationEvidence?: import("./accommodation-evidence").AccommodationEvidence;
  id: string;
  destination: Destination;
  origin: TravelLocation;
  transport: TransportQuote;
  stay: PriceQuote;
  itinerary: LocalizedText[];
};
export type TripCandidate = {
  lodgingTax?: import("./panel-lodging-tax").PanelTax;
  /** Planning band around a reviewed room-panel stay; absent for every other stay basis. */
  stayRange?: { low: MoneyAmount; high: MoneyAmount };
  /** Present only when the stay comes from a reviewed panel figure (observed or scaled). */
  stayFigure?: import("./costs/stay-figures").StayFigureSummary;
  arrival?: import("./destination-access/types").ArrivalAccess;
  directArrival?: import("./destination-access/types").DirectArrival;
  costIntegrity?: CostIntegrity;
  departure?: DepartureAirportCandidate;
  accommodation?: AccommodationEstimate;
  id: string;
  origin: TravelLocation;
  destination: Destination;
  transportMode: "road" | "flight";
  flightPricing?: FlightPricingState;
  costs: CostItem[];
  request: TripRequest;
};
export type TripPlan = TripCandidate & {
  airportSavingCents?: number;
  rankingReason?:
    | "lowestTotal"
    | "selectedAirport"
    | "afterTransfer"
    | "moreBudget";
  requestedDates?: TravelDates;
  itinerary: LocalizedText[];
} & (
    | {
        pricingCompleteness: "complete";
        budget: BudgetBreakdown;
        safetyBuffer: MoneyAmount;
        knownNonFlightCosts?: never;
        flightAffordability?: never;
      }
    | {
        pricingCompleteness: "accommodation-charges-unpriced";
        budget?: never;
        safetyBuffer?: never;
        knownCosts: MoneyAmount;
        knownNonFlightCosts: MoneyAmount;
        flightAffordability: { status: "accommodation-charges-unpriced" };
      }
    | {
        pricingCompleteness: "fit-unconfirmed";
        conditionalTotal: MoneyAmount;
        /** The central estimate fits; these upper bounds do not, or are unbounded. */
        fitUnconfirmedBy: readonly ("stay-range" | "lodging-tax")[];
        upperBoundNeeded?: MoneyAmount;
        budget?: never;
        safetyBuffer?: never;
        knownCosts: MoneyAmount;
        knownNonFlightCosts: MoneyAmount;
        flightAffordability: { status: "accommodation-charges-unpriced" };
      }
    | {
        pricingCompleteness: "property-charges-conditional";
        /** Inclusive planning total plus reserve, excluding disclosed property-dependent extras. */
        conditionalTotal: MoneyAmount;
        budget?: never;
        safetyBuffer?: never;
        knownCosts: MoneyAmount;
        knownNonFlightCosts: MoneyAmount;
        flightAffordability: { status: "accommodation-charges-unpriced" };
      }
    | {
        pricingCompleteness: "required-transfer-unpriced";
        budget?: never;
        safetyBuffer?: never;
        knownCosts: MoneyAmount;
        knownNonFlightCosts: MoneyAmount;
        flightAffordability: { status: "required-transfer-unpriced" };
      }
    | {
        pricingCompleteness: "stay-unpriced";
        budget?: never;
        safetyBuffer?: never;
        knownCosts: MoneyAmount;
        knownNonFlightCosts: MoneyAmount;
        flightAffordability: { status: "stay-unpriced" };
      }
    | {
        pricingCompleteness: "flight-unpriced";
        budget?: never;
        safetyBuffer?: never;
        knownNonFlightCosts: MoneyAmount;
        flightAffordability: import("./budget").FlightAffordability;
      }
  );
export type CompleteTripPlan = Extract<
  TripPlan,
  { pricingCompleteness: "complete" }
>;
export type UnpricedTripPlan = Extract<
  TripPlan,
  {
    pricingCompleteness:
      | "flight-unpriced"
      | "accommodation-charges-unpriced"
      | "fit-unconfirmed"
      | "property-charges-conditional"
      | "required-transfer-unpriced"
      | "stay-unpriced";
  }
>;
export type DemoScenario = "none" | "price-change" | "unavailable";
