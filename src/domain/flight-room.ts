import { money } from "./budget";
import type { MoneyAmount } from "./money/currency";
import type { TripPlan } from "./types";

export type FlightRoom =
  | {
      status: "room";
      known: MoneyAmount;
      /** Present with a reviewed room panel: known costs across the stay's planning band. */
      knownRange?: { low: MoneyAmount; high: MoneyAmount };
      /** Most the whole party's flights can cost for the trip to fit: a budget limit, never a fare. */
      ceiling: MoneyAmount;
      /** The ceiling rounded down to whole units, for display: never overstates the room. */
      upTo: MoneyAmount;
      reserve: MoneyAmount;
      /** Ceiling per person, rounded down to whole units. Omitted with children: their fares differ. */
      perPerson?: MoneyAmount;
      people: number;
    }
  | {
      status: "no-room";
      known: MoneyAmount;
      knownRange?: { low: MoneyAmount; high: MoneyAmount };
      people: number;
    };

/** What the budget leaves for flights when flights are not priced. Undefined otherwise. */
export function flightRoom(plan: TripPlan): FlightRoom | undefined {
  if (plan.pricingCompleteness !== "flight-unpriced") return;
  const { budget, party } = plan.request;
  const people = party.adults + party.children;
  const known = plan.knownNonFlightCosts;
  const stay = plan.accommodation?.quote?.amount.cents;
  const knownRange =
    plan.stayRange && stay !== undefined
      ? {
          low: money(
            known.cents - (stay - plan.stayRange.low.cents),
            budget.currency,
          ),
          high: money(
            known.cents + (plan.stayRange.high.cents - stay),
            budget.currency,
          ),
        }
      : undefined;
  if (plan.flightAffordability.status !== "calculated")
    return {
      status: "no-room",
      known,
      ...(knownRange ? { knownRange } : {}),
      people,
    };
  const ceiling = plan.flightAffordability.ceiling;
  return {
    status: "room",
    known,
    ...(knownRange ? { knownRange } : {}),
    ceiling,
    upTo: money(Math.floor(ceiling.cents / 100) * 100, budget.currency),
    reserve: money(
      Math.max(
        0,
        budget.cents -
          (knownRange?.high ?? known).cents -
          ceiling.cents -
          (plan.lodgingTax?.upperAllowance?.cents ?? 0),
      ),
      budget.currency,
    ),
    perPerson: party.children
      ? undefined
      : money(Math.floor(ceiling.cents / people / 100) * 100, budget.currency),
    people,
  };
}

/** Ranking key for unpriced cards: room for flights per person, highest first. */
export function roomPerPerson(plan: TripPlan): number | undefined {
  const room = flightRoom(plan);
  return room?.status === "room" ? room.ceiling.cents / room.people : undefined;
}
