import { planDerived } from "../money/provenance";
import { completePlan } from "../flight-pricing";
import { formatMoney, type CurrencyCode } from "../money/currency";
import type { TripPlan } from "../types";
import type { AiFailure } from "./intent";
import { flightAffordabilityText } from "../../i18n/flight-affordability";
import type { FlightAffordability } from "../budget";
export type TripExplanationFacts = {
  tripId: string;
  currency: CurrencyCode;
  budgetCents: number;
  options: string[];
} & (
  | {
      pricingCompleteness: "complete";
      spendCents: number;
      reserveCents: number;
      remainingCents: number;
      flightConfidence: "recent" | "none";
    }
  | {
      pricingCompleteness: "flight-unpriced";
      spendCents?: never;
      reserveCents?: never;
      remainingCents?: never;
      flightConfidence: "unavailable";
      knownNonFlightCostsCents: number;
      flightAffordability: FlightAffordability;
      flightAffordabilityMeaning: "budget-ceiling-not-fare-estimate";
    }
);
export type TripExplanationResult =
  | { status: "available"; explanations: { tripId: string; text: string }[] }
  | { status: "unavailable"; reason: AiFailure };
/** Only computed facts and prevalidated localized wording cross the AI boundary. */
export function explanationFacts(
  plans: TripPlan[],
  locale: "en" | "sq",
): TripExplanationFacts[] {
  // Gateway/transfer explanations have not been approved for product AI.
  return plans
    .filter(
      (p) =>
        !p.arrival &&
        (completePlan(p) || p.pricingCompleteness === "flight-unpriced"),
    )
    .slice(0, 3)
    .map((p) => {
      if (!completePlan(p))
        return {
          tripId: p.id,
          currency: p.request.budget.currency,
          budgetCents: p.request.budget.cents,
          pricingCompleteness: "flight-unpriced" as const,
          flightConfidence: "unavailable" as const,
          knownNonFlightCostsCents: p.knownNonFlightCosts.cents,
          flightAffordability: p.flightAffordability,
          flightAffordabilityMeaning:
            "budget-ceiling-not-fare-estimate" as const,
          options: [
            locale === "en"
              ? "We found this destination, but the flight price for your selected dates still needs to be checked. The full trip total is not confirmed."
              : "Gjetëm këtë destinacion, por çmimi i fluturimit për datat e zgjedhura duhet kontrolluar. Totali i udhëtimit nuk është konfirmuar.",
            flightAffordabilityText(
              p.flightAffordability,
              p.request.budget,
              locale,
            ),
          ],
        };
      const remaining = p.budget.remainingAfterReserve.cents;
      const money = formatMoney(
        planDerived(p.budget.remainingAfterReserve, p, true),
        locale,
      );
      const flightConfidence = p.transportMode !== "flight" ? "none" : "recent";
      const budget =
        locale === "en"
          ? `This leaves ${money} after the safety buffer.`
          : `Mbeten ${money} pas rezervës së sigurisë.`;
      const confidence =
        flightConfidence === "recent"
          ? locale === "en"
            ? "The flight price is based on a recent fare, not confirmed availability."
            : "Çmimi i fluturimit bazohet në një tarifë të fundit, jo në disponueshmëri të konfirmuar."
          : locale === "en"
            ? "Trip costs are planning estimates, not confirmed availability."
            : "Kostot e udhëtimit janë vlerësime planifikimi, jo disponueshmëri e konfirmuar.";
      return {
        pricingCompleteness: "complete" as const,
        tripId: p.id,
        currency: p.request.budget.currency,
        budgetCents: p.request.budget.cents,
        spendCents: p.budget.estimatedSpend.cents,
        reserveCents: p.safetyBuffer.cents,
        remainingCents: remaining,
        flightConfidence,
        options:
          p.budget.fit !== "over"
            ? [budget, `${budget} ${confidence}`]
            : [confidence],
      };
    });
}
export function readExplanations(
  value: unknown,
  facts: TripExplanationFacts[],
): TripExplanationResult | undefined {
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).join() !== "explanations"
  )
    return;
  const rows = (value as { explanations: unknown }).explanations;
  if (!Array.isArray(rows) || rows.length > 3) return;
  const seen = new Set<string>();
  for (const row of rows) {
    if (
      !row ||
      typeof row !== "object" ||
      Object.keys(row).sort().join() !== "text,tripId" ||
      typeof row.tripId !== "string" ||
      typeof row.text !== "string" ||
      row.text.length > 400 ||
      seen.has(row.tripId) ||
      !facts.find((f) => f.tripId === row.tripId)?.options.includes(row.text)
    )
      return;
    seen.add(row.tripId);
  }
  return { status: "available", explanations: rows };
}
