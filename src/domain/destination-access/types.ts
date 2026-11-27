import type {
  Destination,
  FlightDiscoveryFare,
  LocalizedText,
  MoneyAmount,
} from "../types";
import type { CurrencyCode } from "../money/currency";
import type {
  FxConversionProvenance,
  ObservedForeignAmount,
} from "../money/fx";

/** Access is a relationship, never equality between an airport and a place. */
export type TransferPolicy =
  | { kind: "unpriced" }
  | {
      kind: "estimate";
      amount: MoneyAmount;
      unit: "person-return";
      reviewAfter: string;
      sourceIds: string[];
    }
  | {
      kind: "observed";
      reviewStatus: "draft" | "reviewed";
      reviewAfter: string;
      mode: "bus" | "rail";
      basis: LocalizedText;
      observation: ObservedForeignAmount;
      unit: "adult-one-way";
      sameFareBothDirections: true;
      fxSnapshotId: string;
    };
export type TransferProvenance = {
  mode: "bus" | "rail";
  basis: LocalizedText;
  observation: ObservedForeignAmount;
  derivation: "two-one-way-adult-fares";
  partyPolicy: "adult-allowance-every-traveller";
  fx: FxConversionProvenance;
  rounding: "up-target-minor-unit-per-person-return";
};
export type TransferUnpricedReason =
  | "no-reviewed-price"
  | "stale-price"
  | "stale-fx"
  | "unsupported-currency"
  | "airport-unconfirmed"
  | "source-invalid"
  | "overflow";
export type ArrivalGateway = {
  provider: "travelpayouts";
  providerCityCode: string;
  cityLabel: LocalizedText;
  airportCode: string;
  sourceIds: string[];
  onwardTransfer: { required: true; pricing: TransferPolicy };
};
/** Provider grouping describes airports serving a city, not their municipal geography. */
export type DirectCityBinding = {
  provider: "travelpayouts";
  providerCityCode: string;
  airportCodes: string[];
  sourceIds: string[];
};
/** A reviewed direct arrival group; never an alias for the final place geography. */
export type DirectDestinationEntry = DirectCityBinding & {
  cityLabel: LocalizedText;
};
/** Recognition can exceed the query budget only with an explicit reviewed search policy. */
export type DirectRestorationPolicy = {
  providerCityCodes: string[];
  sourceIds: string[];
  rationale: string;
};
type AccessReview = {
  destinationSubject: string;
  reviewStatus: "draft" | "reviewed";
  reviewedAt: string | null;
  reviewAfter: string;
  reviewOwner: string;
  sources: { id: string; url: string; checkedAt: string }[];
};
export type DestinationAccessProfile = AccessReview &
  (
    | {
        relationship: "direct-city";
        directCity: DirectCityBinding;
        directEntries?: never;
        restoration?: never;
        gateways?: never;
      }
    | {
        relationship: "direct-destination";
        directEntries: DirectDestinationEntry[];
        restoration?: DirectRestorationPolicy;
        directCity?: never;
        gateways?: never;
      }
    | {
        relationship: "mixed-access";
        directEntries: DirectDestinationEntry[];
        gateways: ArrivalGateway[];
        restoration: DirectRestorationPolicy;
        directCity?: never;
      }
    // Existing v1 gateway records retain their required-transfer semantics without a data migration.
    | {
        relationship?: "external-gateway";
        gateways: ArrivalGateway[];
        directCity?: never;
        directEntries?: never;
        restoration?: never;
      }
  );
export type DestinationAccessData = {
  schemaVersion: 1;
  records: DestinationAccessProfile[];
};
export type OnwardTransfer =
  | { status: "unpriced"; required: true; reason?: TransferUnpricedReason }
  | {
      status: "estimate";
      required: true;
      perPersonReturn: MoneyAmount;
      reviewAfter: string;
      sourceIds: string[];
      provenance?: TransferProvenance;
    };
/** Safe presentation context; no review record or operator evidence crosses into UI. */
export type ArrivalAccess = {
  destinationSubject: string;
  providerCityCode: string;
  flightDestinationCode: string;
  airportCode?: string;
  label: LocalizedText;
  onwardTransfer: OnwardTransfer;
};
export type AccessibleDestination = {
  destination: Destination;
  directCity?: DirectCityBinding;
  directEntries?: DirectDestinationEntry[];
  restorationGroups?: string[];
  gateways: ArrivalGateway[];
  /** Server-derived supported-currency allowances; no snapshot/rate table reaches the plan. */
  transferPrices: Record<string, Partial<Record<CurrencyCode, OnwardTransfer>>>;
};
/** Presentation only. Unlike ArrivalAccess this never requires a gateway transfer. */
export type DirectArrival = {
  label: LocalizedText;
  flightDestinationCode: string;
  airportCode?: string;
};
export interface DestinationAccessStore {
  get(subject: string): AccessibleDestination | undefined;
  directForCode(code: string): AccessibleDestination | undefined;
  forFare(fare: FlightDiscoveryFare): AccessibleDestination[];
}
