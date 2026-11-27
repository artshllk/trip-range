import { completePlan, matchingFlight } from "./flight-pricing";
import { flightRoom, roomPerPerson } from "./flight-room";
import { assertCurrency } from "./money/currency";
import { chooseDeparturePlans } from "./airport-comparison";
import { matchesDestination } from "./locations";
import type { TripPlan, TripRequest } from "./types";
export function matchingPlans(plans: TripPlan[], request: TripRequest) {
  for (const plan of plans)
    assertCurrency(plan.request.budget, request.budget.currency);
  return plans.filter(
    (p) =>
      matchesDestination(p.destination, request.destination) &&
      (!request.noFlight || p.transportMode === "road") &&
      (request.scope !== "domestic" ||
        p.destination.countryCode === p.origin.countryCode) &&
      request.styles.every((s) => p.destination.styles.includes(s)),
  );
}
/** Results-page cards when nothing is priced, the normal state for our home markets.
 * Other surfaces (SEO landings, planner counts) keep the default three. */
export const MAX_UNPRICED_CARDS = 6;
/** Unpriced trips: most room for flights per person first, then other incomplete
 * prices, then trips whose non-flight costs already use the budget. Stable, so the
 * departure order breaks ties. Ranks on estimates and the budget, never on a fare. */
function rankUnpriced(plans: TripPlan[]) {
  const group = (p: TripPlan) => {
    const room = flightRoom(p);
    return room?.status === "room" ? 0 : room ? 2 : 1;
  };
  return [...plans].sort(
    (a, b) =>
      group(a) - group(b) || (roomPerPerson(b) ?? 0) - (roomPerPerson(a) ?? 0),
  );
}
export function curate(
  plans: TripPlan[],
  request: TripRequest,
  { unpricedCards = 3 }: { unpricedCards?: number } = {},
) {
  const ranked = chooseDeparturePlans(matchingPlans(plans, request));
  const complete = ranked.filter(completePlan);
  const ideas = rankUnpriced(ranked.filter((p) => !completePlan(p)));
  const affordable = complete.filter((p) => p.budget.fit !== "over");
  const fits = affordable.slice(0, 3);
  // Keep two cheapest choices, but don't let domestic fixtures hide all discovered international ideas.
  const international = affordable.find(
    (p) =>
      matchingFlight(p) && p.destination.countryCode !== p.origin.countryCode,
  );
  if (
    request.scope === "anywhere" &&
    international &&
    !fits.includes(international) &&
    fits.every((p) => p.destination.countryCode === p.origin.countryCode)
  )
    fits[fits.length - 1] = international;
  // Keep the two cheapest choices. A similarly priced new city can diversify an otherwise
  // entirely curated shortlist; this never changes its estimate or bypasses the user's budget.
  const dynamic = affordable.find(
    (p) => p.destination.metadataSource === "travelpayouts-autocomplete",
  );
  if (
    !request.destination &&
    fits.length === 3 &&
    dynamic &&
    !fits.some((p) => p.destination.metadataSource) &&
    dynamic.budget.budgetNeeded.cents * 100 <=
      fits[2].budget.budgetNeeded.cents * 115
  )
    fits[2] = dynamic;
  const ideaSlots = fits.length ? Math.max(0, 3 - fits.length) : unpricedCards;
  return {
    fits,
    ideas: ideas.slice(0, ideaSlots),
    cards: [...fits, ...ideas.slice(0, ideaSlots)],
    pricingState: affordable.length
      ? ("priced-results" as const)
      : complete.length
        ? ("no-fit" as const)
        : ("insufficient-pricing" as const),
    completeCount: complete.length,
    fitCount: affordable.length,
    slightlyOver: complete
      .filter(
        (p) =>
          p.budget.fit === "over" &&
          p.budget.budgetNeeded.cents * 100 <= request.budget.cents * 115,
      )
      .slice(0, 3),
    cheapest: complete[0],
  };
}
