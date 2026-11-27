import { curate, matchingPlans, MAX_UNPRICED_CARDS } from "./ranking";
import { matchingFlight } from "./flight-pricing";
import type { TripPlan, TripRequest } from "./types";

/** Flight templates may have legacy planning allowances, but those do not
 * establish whole-trip affordability. Keep these cards out of fit/over groups. */
export function curateTripCards(plans: TripPlan[], request: TripRequest) {
  const road = curate(
    plans.filter((p) => p.transportMode === "road"),
    request,
  );
  const flights = matchingPlans(plans, request)
    .filter((p) => p.transportMode === "flight")
    .sort((a, b) => {
      const fare = (p: TripPlan) =>
        matchingFlight(p)?.price.amount.cents ?? Infinity;
      return (
        fare(a) - fare(b) ||
        Number(!a.departure?.selected) - Number(!b.departure?.selected) ||
        a.id.localeCompare(b.id)
      );
    });
  const seen = new Set<string>();
  const ideas = flights
    .filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    })
    .slice(0, MAX_UNPRICED_CARDS);
  return {
    ...road,
    ideas: [...road.ideas, ...ideas],
    cards: [...road.cards, ...ideas],
    pricingState:
      ideas.length && !road.fits.length
        ? ("insufficient-pricing" as const)
        : road.pricingState,
  };
}
