import type { MonthFare } from "./month-discovery";

const dateKey = (f: MonthFare) =>
  `${f.destination}|${f.departure}|${f.returning}`;
const quoteKey = (f: MonthFare) =>
  `${dateKey(f)}|${f.airport}|${f.partyCents}|${f.observedAt}`;
const sorted = (set: Set<string>) => [...set].sort();

// Compare eligible options, not raw rows or fetch timestamps. A cheaper quote or
// a newer provider observation on an existing departure is not a new trip choice.
export function sweepYield(
  previous: MonthFare[],
  current: MonthFare[],
  previousAt: string,
) {
  const oldDates = new Set(previous.map(dateKey));
  const newDates = new Set(current.map(dateKey));
  const oldCities = new Set(previous.map((f) => f.destination));
  const newCities = new Set(current.map((f) => f.destination));
  const oldQuotes = new Set(previous.map(quoteKey));
  const addedDates = current.filter((f) => !oldDates.has(dateKey(f)));
  const newer = current.filter(
    (f) => Date.parse(f.observedAt) > Date.parse(previousAt),
  );
  return {
    addedDestinations: sorted(
      new Set(
        current
          .filter((f) => !oldCities.has(f.destination))
          .map((f) => f.destination),
      ),
    ),
    removedDestinations: sorted(
      new Set(
        previous
          .filter((f) => !newCities.has(f.destination))
          .map((f) => f.destination),
      ),
    ),
    addedDates: addedDates.map((f) => ({
      destination: f.destination,
      departure: f.departure,
      returning: f.returning,
    })),
    removedDates: previous
      .filter((f) => !newDates.has(dateKey(f)))
      .map((f) => ({
        destination: f.destination,
        departure: f.departure,
        returning: f.returning,
      })),
    newerProviderTimestampOptions: newer.length,
    identicalQuotes: current.filter((f) => oldQuotes.has(quoteKey(f))).length,
    addedDatesWithNewerProviderTimestamp: addedDates.filter(
      (f) => Date.parse(f.observedAt) > Date.parse(previousAt),
    ).length,
  };
}
