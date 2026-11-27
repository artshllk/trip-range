import type { Destination } from "./types";

/** Owner decision, 2026-11-03. Model semantics, not evidence of an observed price. */
export const ACCOMMODATION_ALLOWANCE_DEFINITION = {
  id: "displayed-stay-separate-tax-v2",
  statutoryAccommodationTax: "as-displayed",
  mandatoryFees: "included-except-property-dependent",
  addStatutoryTax: false,
} as const;

export type AccommodationChargeCoverage =
  | { status: "panel"; basis: "displayed-rate" }
  | { status: "included"; basis: "inclusive-allowance" | "provider-total" }
  | {
      status: "property-dependent";
      charge: "zurich-city-tax" | "manchester-bid" | "stuttgart-pass-through";
    }
  | {
      status: "unresolved";
      reason: "unknown-mandatory-charges" | "unresolved-provider-condition";
    };

/** Disclosure only: no rates, amounts, research imports or tax calculations.
 * Match the final destination identity, never an airport used as a gateway. */
export function allowanceChargeCoverage(
  destination?: Destination,
): AccommodationChargeCoverage {
  const id = destination?.id ?? "";
  if (
    destination?.countryCode === "CH" &&
    ["zurich", "city:ZRH", "place:Q72"].includes(id)
  )
    return { status: "property-dependent", charge: "zurich-city-tax" };
  if (
    destination?.countryCode === "GB" &&
    ["manchester", "city:MAN"].includes(id)
  )
    return { status: "property-dependent", charge: "manchester-bid" };
  if (
    destination?.countryCode === "DE" &&
    ["stuttgart", "city:STR"].includes(id)
  )
    return { status: "property-dependent", charge: "stuttgart-pass-through" };
  return { status: "included", basis: "inclusive-allowance" };
}
