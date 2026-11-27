import type { LocalizedCopy } from "./localized";

/**
 * Copy for a trip without a flight price (docs/specs/partial-data-result-card.md).
 * - findFlights/perPerson: a budget limit derived from the user's budget, our
 *   estimates and the reserve. Never a fare, never "from €", never a total.
 * - notPriced: we have no fare for these dates; say so plainly, no figure.
 * - noRoom: the non-flight estimate alone already uses the budget.
 * - header/sorted: one line for the whole results list, so cards need not repeat it.
 */
export const flightRoomCopy = {
  en: {
    budget: "Your budget",
    costs: "Stay and local costs",
    estimate: "estimate",
    range: "{low}–{high}",
    flights: "Flights",
    notPriced: "not priced",
    findFlights: "Find return flights under {amount}",
    forParty: "for {people}",
    person: "1 person",
    people: "{n} people",
    perPerson: "up to {amount} per person, return",
    limitNote: "Budget limit, not a fare. It accounts for the reserve and any higher stay costs or possible tax shown.",
    noRoom: "The estimates, reserve and any possible tax leave no room for flights.",
    legendKnown: "Estimated costs",
    legendReserve: "Set aside",
    legendRoom: "Flight budget",
    status: "Flights not priced",
    header:
      "We have no flight price for these dates. Where enough costs are known, we show a flight budget limit.",
    sorted: "Sorted by flight budget limit per person, highest first.",
    unpricedCount: "{n} without a flight price",
  },
} as const satisfies LocalizedCopy<unknown>;
