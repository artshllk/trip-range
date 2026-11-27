import { assertCurrency } from "./money/currency";
import { planningCostPolicy } from "./money/planning-rates";
import { completePlan, matchingFlight } from "./flight-pricing";
import type { TripPlan } from "./types";
/** EUR-only transfer policy: minimum €30, 10% of spend, or €20 per one-way transfer hour. */
export function minimumAirportSaving(
  selectedSpendCents: number,
  oneWayMinutes: number,
) {
  return Math.max(
    3000,
    Math.ceil(selectedSpendCents / 10),
    Math.ceil((oneWayMinutes * 2000) / 60),
  );
}
export function comparableAirportTrips(a: TripPlan, b: TripPlan) {
  return (
    completePlan(a) &&
    completePlan(b) &&
    a.request.budget.currency === b.request.budget.currency &&
    a.id === b.id &&
    a.transportMode === "flight" &&
    b.transportMode === "flight" &&
    a.request.dates.startDate === b.request.dates.startDate &&
    a.request.dates.endDate === b.request.dates.endDate &&
    a.request.party.adults === b.request.party.adults &&
    a.request.party.children === b.request.party.children &&
    !!matchingFlight(a) &&
    !!matchingFlight(b)
  );
}
export function withAirportComparison(
  plan: TripPlan,
  all: TripPlan[],
): TripPlan {
  const direct = all.find(
    (p) => p.departure?.selected && comparableAirportTrips(p, plan),
  );
  const transfer = plan.departure?.transfer;
  if (
    plan.departure?.selected ||
    !transfer ||
    !direct ||
    !completePlan(plan) ||
    !completePlan(direct) ||
    transfer.amount.currency !== "EUR" ||
    plan.request.budget.currency !== "EUR"
  )
    return {
      ...plan,
      airportSavingCents: undefined,
      rankingReason: plan.departure?.selected
        ? "selectedAirport"
        : "lowestTotal",
    };
  const saving =
    direct.budget.estimatedSpend.cents - plan.budget.estimatedSpend.cents;
  const meaningful =
    saving >=
    minimumAirportSaving(
      direct.budget.estimatedSpend.cents,
      transfer.durationMinutes,
    );
  return {
    ...plan,
    airportSavingCents: meaningful ? saving : undefined,
    rankingReason: meaningful ? "afterTransfer" : "lowestTotal",
  };
}
function costTrust(plan: TripPlan) {
  return (
    (plan.costIntegrity?.providerComponents?.length ?? 0) +
    (plan.costIntegrity?.status === "reviewed"
      ? 2
      : plan.costIntegrity?.status === "mixed"
        ? 1
        : 0)
  );
}
export function comparePlans(a: TripPlan, b: TripPlan) {
  assertCurrency(a.request.budget, b.request.budget.currency);
  if (completePlan(a) && !completePlan(b)) return -1;
  if (!completePlan(a) && completePlan(b)) return 1;
  if (!completePlan(a) || !completePlan(b))
    return (
      Number(!!matchingFlight(b)) - Number(!!matchingFlight(a)) ||
      Number(b.flightPricing?.kind === "reference") -
        Number(a.flightPricing?.kind === "reference") ||
      Number(!a.departure?.selected) - Number(!b.departure?.selected) ||
      a.id.localeCompare(b.id)
    );
  const band = planningCostPolicy[a.request.budget.currency].rankingBand;
  return (
    Number(a.budget.fit === "over") - Number(b.budget.fit === "over") ||
    Math.floor(a.budget.budgetNeeded.cents / band) -
      Math.floor(b.budget.budgetNeeded.cents / band) ||
    Number(!!matchingFlight(b)) - Number(!!matchingFlight(a)) ||
    // Within the existing budget band, prefer stronger destination-cost evidence.
    costTrust(b) - costTrust(a) ||
    (a.departure?.transfer?.durationMinutes ?? 0) -
      (b.departure?.transfer?.durationMinutes ?? 0) ||
    a.budget.budgetNeeded.cents - b.budget.budgetNeeded.cents ||
    a.id.localeCompare(b.id) ||
    (a.departure?.code ?? "").localeCompare(b.departure?.code ?? "")
  );
}
export function chooseDeparturePlans(plans: TripPlan[]): TripPlan[] {
  const decorated = plans.map((p) => withAirportComparison(p, plans));
  const eligible = decorated
    .filter((p) => {
      if (!p.departure?.transfer) return true;
      const direct = decorated.find(
        (d) => d.departure?.selected && comparableAirportTrips(d, p),
      );
      return !direct || !!p.airportSavingCents;
    })
    .sort(comparePlans);
  return [...new Set(eligible.map((p) => p.id))]
    .map((id) => {
      const options = eligible.filter((p) => p.id === id);
      const recommended = options.filter((p) => p.airportSavingCents);
      return (recommended.length ? recommended : options).sort(comparePlans)[0];
    })
    .sort(comparePlans);
}
