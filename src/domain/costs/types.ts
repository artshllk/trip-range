import type { CurrencyCode, MoneyAmount } from "../money/currency";
export type DestinationCostId = `city:${string}` | `place:Q${number}`;
export type DestinationCostComponent =
  | "stay"
  | "food"
  | "localTransport"
  | "arrivalTransport"
  | "activities";
export type PlanningCostBasis =
  | "provider-availability"
  | "reviewed-destination"
  | "generic-currency"
  | "curated-legacy"
  | "planning-allowance";
export type CostProfileReference = {
  id: string;
  revision: string;
  destinationId: DestinationCostId;
  currency: CurrencyCode;
  reviewedAt: string;
  reviewAfter: string;
};
export type PlanningCostProvenance = {
  transfer?: import("../destination-access/types").TransferProvenance;
  component:
    | DestinationCostComponent
    | "baggage"
    | "departureTransfer"
    | "gatewayTransfer"
    | "car";
  basis: PlanningCostBasis;
  profile?: CostProfileReference;
  sourceIds: readonly string[];
  basket?: { en: string; sq?: string };
};
export type CostAssumption = {
  amount: MoneyAmount;
  unit:
    | "room-night"
    | "person-day"
    | "person-trip"
    | "party-trip"
    | "person-night";
  basket: { en: string; sq?: string };
  sourceIds: readonly string[];
};
export type DestinationCostProfile = CostProfileReference & {
  countryCode: string;
  reviewStatus: "draft" | "reviewed";
  maxNights: number;
  // Partial reviews are supported, but can never establish full publication coverage.
  costs: Partial<Record<DestinationCostComponent, CostAssumption>>;
  sourceReferences: readonly {
    id: string;
    url: string;
    type:
      | "official-transport"
      | "official-tourism"
      | "accommodation-observation"
      | "official-menu"
      | "official-attraction"
      | "consumer-study";
    checkedAt: string;
  }[];
};
export type CostIntegrity = {
  providerComponents?: readonly DestinationCostComponent[];
  status: "reviewed" | "mixed" | "generic";
  reviewedComponents: readonly DestinationCostComponent[];
  generalComponents: readonly DestinationCostComponent[];
  profile?: CostProfileReference;
};
