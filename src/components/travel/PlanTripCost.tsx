import type { TripPlan } from "../../domain/types";
import { destinationCostId } from "../../domain/costs/identity";
import { reviewedStayData } from "../../domain/costs/reviewed-stay-data";
import { publishedRooms } from "../../domain/costs/published-rooms";
import { roomEvidence } from "../../domain/room-evidence";
import { matchingFlight } from "../../domain/flight-pricing";
import { TripCostCard } from "./TripCostCard";

/** Existing flight searches share the launch card's evidence policy. Legacy
 * planning parameters are not evidence for room prices or a budget verdict. */
export function PlanTripCost({ plan }: { plan: TripPlan }) {
  const transport =
    matchingFlight(plan) &&
    plan.costs.find((c) => c.category === "transport" && !c.demo);
  const code = destinationCostId(plan.destination)?.replace(/^city:/, "") ?? "";
  const evidence = roomEvidence(
    code,
    plan.destination.countryCode,
    new Date().toISOString().slice(0, 10),
    publishedRooms,
    reviewedStayData,
    plan.destination.name.en,
  );
  return (
    <TripCostCard
      city={plan.destination.name.en}
      country={plan.destination.country.en}
      evidence={evidence}
      observedAt={transport ? (transport.observedAt ?? undefined) : undefined}
      costs={{
        flightCents: transport ? transport.amount.cents : undefined,
        flightCurrency: transport ? transport.amount.currency : undefined,
        children: plan.request.party.children,
        budgetCents:
          plan.request.budget.currency === "EUR"
            ? plan.request.budget.cents
            : 0,
        checkIn: plan.request.dates.startDate,
        checkOut: plan.request.dates.endDate,
        adults: plan.request.party.adults,
        rooms: 1,
      }}
    />
  );
}
