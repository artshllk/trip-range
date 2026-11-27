import { launchTransfers } from "../providers/nearby-airports";
/** Editorial methodology, not provider inventory and never an AI prompt. */
export const budgetMethodology = [
  {
    name: "Flight",
    detail:
      "A matching recent provider fare is required for a complete trip total. Without it the flight price is unavailable and only other estimated costs are shown. Monthly fares for other dates are reference information, not the price of the displayed trip.",
  },
  {
    name: "Accommodation",
    detail:
      "A Trip Range room-and-night estimate for the selected party and stay level. No hotel inventory or reservation is included.",
  },
  {
    name: "Food",
    detail:
      "A daily planning allowance for everyone travelling, across the length of the trip.",
  },
  {
    name: "Local transport",
    detail: "An estimate for getting around at the destination.",
  },
  {
    name: "Activities",
    detail:
      "A planning allowance, not tickets or confirmed attraction availability.",
  },
  {
    name: "Nearby-airport transfer",
    detail:
      "Included when a supported alternative departure airport is selected. Transfer costs and journey time are estimates.",
  },
  {
    name: "Baggage",
    detail:
      "An estimated allowance when baggage is selected. Check the final airline baggage rules and charges.",
  },
  {
    name: "Safety buffer",
    detail:
      "Reserved money, not expected spending. For a completely priced trip, budget needed equals estimated trip spending plus this reserve. No full-trip buffer is calculated while the flight price is missing.",
  },
] as const;
export const fareDisclosure =
  "Recent flight fares are cached observations, not guaranteed live inventory. Final flight price and availability are confirmed on Aviasales or the booking provider’s website. Bookings happen externally.";
export const nearbyNote =
  "A lower fare from another airport is useful only after adding the transfer cost and time. Trip Range compares supported nearby airports using the whole-trip budget. Basel and Geneva are future origin candidates; they are not currently included as Zurich alternatives in Trip Range’s curated airport comparison. No savings are assumed here.";

const launchAirportNames: Record<string, string> = {
  TIA: "Tirana",
  PRN: "Prishtina",
  SKP: "Skopje",
};
/** Read from the curated transfer allowances; never a saving claim. */
export function launchNearbyNote(code: string) {
  const others = Object.entries(launchTransfers[code]).map(
    ([other, policy]) =>
      `${launchAirportNames[other]} (about ${Math.round(policy.oneWayMinutes / 60)} hours by road in our planning allowance)`,
  );
  return `A cheaper fare from ${others.join(" or ")} only helps once the transfer is counted. With nearby airports turned on, Trip Range adds a transfer allowance to the whole-trip budget before comparing. No saving is assumed here.`;
}
/** General questions shown once, on /methodology, never repeated per page. */
export const methodologyQuestions = [
  {
    question: "Is the budget per person or for the whole trip?",
    answer:
      "For the whole trip and everyone in it, including the safety buffer. Flight fares may arrive as per-traveller quotes; Trip Range calculates the party total before comparing it with your budget.",
  },
  {
    question: "Can I use a different budget or travel with more people?",
    answer:
      "Yes. Change the budget, dates or travellers in the search and the same cost categories are recalculated. Example amounts on Trip Range pages are search inputs, not price promises.",
  },
  {
    question: "Will a fare for nearby dates change my trip automatically?",
    answer:
      "No. With exact dates, only matching fares can price the flight. A monthly fare for other dates stays reference information. If you explicitly allow flexibility, alternatives show their actual dates.",
  },
  {
    question: "What happens if the flight price changes?",
    answer:
      "Recheck the flight on the provider’s website before booking. A recent cached fare can change or disappear. Accommodation, food and other local costs remain estimates, and the buffer is not a guarantee against every price change.",
  },
] as const;
