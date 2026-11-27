import { addDays, isCalendarDate, resolveTravelDates } from "./dates";
import { isExcludedTravelDestinationId } from "./destination-lifecycle";
import { money, safetyBufferFor } from "./budget";
import type { Query } from "./request";

export type MonthFare = {
  destination: string;
  /** Destination airport of the itinerary. */
  airport: string;
  /** Departure airport the itinerary actually leaves from, when the provider states it. */
  originAirport?: string | null;
  departure: string;
  returning: string;
  partyCents: number;
  observedAt: string;
};

export function nextMonth(month: string) {
  return resolveTravelDates("month", month + "-01").startDate.slice(0, 7);
}

export function discoveryMonths(today: string, selected?: string) {
  const current = today.slice(0, 7);
  if (selected && selected >= current && isCalendarDate(selected + "-01")) {
    return [selected];
  }
  return [current, nextMonth(current)];
}

// Retain links to existing custom searches, including exact dates and weekend presets.
export function isMonthDiscovery(query: Query) {
  return Object.keys(query).every(
    (key) =>
      ["month", "ceiling", "depart", "food", "stars", "nights"].includes(key) ||
      key.startsWith("utm_") ||
      key === "gclid",
  );
}

export const flightCeilings = [600, 800, 1000, 1200] as const;
export const minimumComparisonCities = 3;

export function monthDestinations(
  rows: MonthFare[],
  month: string,
  today: string,
  now: number,
  ceiling: number,
  /** Stay length; two nights for the collector until it collects other lengths. */
  nights = 2,
) {
  const byCity = new Map<string, Map<string, MonthFare>>();
  for (const fare of rows) {
    const seen = Date.parse(fare.observedAt);
    if (
      !Number.isFinite(seen) ||
      seen > now ||
      now - seen > 7 * 86400000 ||
      !fare.departure.startsWith(month + "-") ||
      // No same-day departures (owner decision, 26 November 2026): a stored fare for
      // a flight leaving today is up to seven days old and almost certainly gone,
      // yet it would be the first card a visitor sees. May be revisited with
      // evidence on how near-date fares actually hold.
      fare.departure <= today ||
      !isCalendarDate(fare.departure) ||
      fare.returning !== addDays(fare.departure, nights) ||
      !/^[A-Z]{3}$/.test(fare.airport) ||
      !/^[A-Z]{3}$/.test(fare.destination) ||
      isExcludedTravelDestinationId("city:" + fare.destination) ||
      isExcludedTravelDestinationId("airport:" + fare.airport) ||
      !Number.isSafeInteger(fare.partyCents) ||
      fare.partyCents <= 0
    )
      continue;

    if (
      fare.partyCents + safetyBufferFor(money(fare.partyCents, "EUR")).cents >
      ceiling * 100
    )
      continue;
    const dates = byCity.get(fare.destination) ?? new Map<string, MonthFare>();
    const existing = dates.get(fare.departure);
    if (
      !existing ||
      fare.partyCents < existing.partyCents ||
      (existing.partyCents === fare.partyCents &&
        seen > Date.parse(existing.observedAt))
    ) {
      dates.set(fare.departure, fare);
      byCity.set(fare.destination, dates);
    }
  }
  return [...byCity]
    .map(([destination, dates]) => {
      const options = [...dates.values()].sort((a, b) =>
        a.departure.localeCompare(b.departure),
      );
      return {
        destination,
        options,
        minimum: Math.min(...options.map((o) => o.partyCents)),
      };
    })
    .sort(
      (a, b) =>
        a.minimum - b.minimum || a.destination.localeCompare(b.destination),
    );
}
