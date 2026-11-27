import Link from "next/link";
import { connection } from "next/server";
import { referenceToday } from "@/services/current-request";
import { monthFares, monthRefreshHealth } from "@/server/fare-store";
import {
  defaultPlanOrigin,
  planOrigin,
  planOrigins,
  type PlanOrigin,
} from "@/domain/plan-origins";
import {
  discoveryMonths,
  flightCeilings,
  minimumComparisonCities,
  monthDestinations,
  nextMonth,
} from "@/domain/month-discovery";
import { planNights, nightsAdjective } from "@/domain/stay-length";
import { MonthDestinationCard } from "./MonthDestinationCard";
import { roomEvidence } from "@/domain/room-evidence";
import { publishedRooms } from "@/domain/costs/published-rooms";
import { reviewedStayData } from "@/domain/costs/reviewed-stay-data";
import { monthPlace } from "@/domain/month-places";
import screen from "../../../content/fares/tirana-screen-2026-11-16.json";
import type { Query } from "@/domain/request";
import { customPlannerEnabled } from "@/config/features";
import {
  budgetLeft,
  defaultHotelClass,
  hotelClasses,
  type BudgetLeft,
  type HotelClass,
} from "@/domain/budget-left";
import {
  airportTransferRecords,
  attractionRecords,
  cityTaxRecords,
} from "@/domain/city-cost-records";
import { attractionsForStay, type StayAttraction } from "@/domain/attractions";
import { fxData } from "../../../content/money/fx/records";
import "./month-planner.css";

const monthFormat = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const euros = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
});
const monthName = (m: string) =>
  monthFormat.format(new Date(m + "-01T12:00:00Z"));

export async function MonthPlanner({
  query,
  questions,
  fixedOrigin,
  plannerOff,
}: {
  query: Query;
  questions?: readonly { question: string; answer: string }[];
  /** A landing page whose path names the origin (/from/tirana). */
  fixedOrigin?: PlanOrigin;
  /** Reached with custom-planner parameters while that planner is switched off. */
  plannerOff?: boolean;
}) {
  await connection();
  const now = new Date();
  const today = referenceToday(now);
  const selected = typeof query.month === "string" ? query.month : undefined;
  const months = discoveryMonths(today, selected);
  const ceiling =
    flightCeilings.find((n) => n.toString() === query.ceiling) ?? 600;
  const monitored = discoveryMonths(today);
  // The origin lives only in the URL (?depart=london); nothing is stored on the device.
  const { origin, unknown } = fixedOrigin
    ? { origin: fixedOrigin, unknown: undefined }
    : planOrigin(query.depart);
  // Trip length lives in the URL too (?nights=3); three nights by default.
  const { nights, offered, notCollected } = planNights(
    origin.code,
    query.nights,
  );
  const length = nightsAdjective(nights);
  const [live, health] = await Promise.all([
    notCollected === undefined
      ? monthFares(
          origin.code,
          today > months[0] + "-01" ? today : months[0] + "-01",
          nextMonth(months[months.length - 1]) + "-01",
          nights,
        )
      : Promise.resolve([]),
    monthRefreshHealth(
      origin.code,
      months.filter((month) => monitored.includes(month)),
    ),
  ]);
  // The dated Tirana launch audit supplies additional corroborated itineraries. Every
  // row expires by its own provider timestamp, even when the store is unavailable.
  const rows = [
    ...(live ?? []),
    // The launch screen is a two-night snapshot.
    ...(origin.code === "TIA" &&
    nights === 2 &&
    notCollected === undefined &&
    Date.parse(screen.capturedAt) <= now.getTime()
      ? screen.fares
      : []),
  ];
  // The traveller's own food amount (euros a day for two) and hotel class travel
  // only in the URL. No food amount means none: never a default.
  const foodEuros =
    typeof query.food === "string" && /^\d{1,4}$/.test(query.food)
      ? Math.min(Number(query.food), 5000)
      : undefined;
  const hotelClass: HotelClass = hotelClasses.includes(
    query.stars as HotelClass,
  )
    ? (query.stars as HotelClass)
    : defaultHotelClass;
  const reset =
    "/plan?" +
    new URLSearchParams({
      ...(origin.slug === defaultPlanOrigin.slug
        ? {}
        : { depart: origin.slug }),
      ceiling: String(ceiling),
      nights: String(nights),
      ...(foodEuros !== undefined ? { food: String(foodEuros) } : {}),
      ...(hotelClass !== defaultHotelClass ? { stars: hotelClass } : {}),
    }).toString();
  return (
    <main id="main" className="shell section stack month-planner">
      <header>
        <h1>
          {length[0].toUpperCase() + length.slice(1)} trips from {origin.name}
        </h1>
        <p>
          Compare flight costs, room evidence and dates for two adults. Start
          with returns seen by Aviasales in the past seven days, then check
          rooms for your stay.
        </p>
      </header>
      {plannerOff && (
        <p role="status">
          Planning with your own dates and travellers isn’t available yet. Here
          are {length} return flights for two within your budget.
        </p>
      )}
      {notCollected !== undefined && (
        <p role="status">
          We don’t collect {nightsAdjective(notCollected)} trips from{" "}
          {origin.name}. Choose{" "}
          {offered.length === 1
            ? offered[0]
            : offered.slice(0, -1).join(", ") + " or " + offered.at(-1)}{" "}
          nights.
        </p>
      )}
      {unknown !== undefined && (
        <p role="status">
          We don’t collect fares from “{unknown}” yet. Showing {origin.name}.
        </p>
      )}
      <form action="/plan" className="month-controls">
        <label>
          Departing from
          <select name="depart" defaultValue={origin.slug}>
            {planOrigins.map((o) => (
              <option key={o.slug} value={o.slug}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Trip length
          <select name="nights" defaultValue={nights}>
            {offered.map((n) => (
              <option key={n} value={n}>
                {n} nights
              </option>
            ))}
          </select>
        </label>
        <label>
          Departure month
          {/* A select, not type="month": phones render an empty month input
              as "--------- ----", and only monitored months have fares. */}
          <select
            name="month"
            defaultValue={months.length === 1 ? months[0] : ""}
          >
            <option value="">All upcoming months</option>
            {monitored.map((m) => (
              <option key={m} value={m}>
                {monthFormat.format(new Date(m + "-01T00:00:00Z"))}
              </option>
            ))}
          </select>
        </label>
        <label>
          Trip budget for two
          <select name="ceiling" defaultValue={ceiling}>
            {flightCeilings.map((n) => (
              <option key={n} value={n}>
                {euros.format(n)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Food for two, per day (optional)
          <input
            type="number"
            name="food"
            min={0}
            max={5000}
            step={1}
            inputMode="numeric"
            placeholder="€"
            defaultValue={foodEuros ?? ""}
          />
        </label>
        <label>
          Hotel class (for city tax)
          <select name="stars" defaultValue={hotelClass}>
            {hotelClasses.map((c) => (
              <option key={c} value={c}>
                {c}-star
              </option>
            ))}
          </select>
        </label>
        <button className="button ember" type="submit">
          Show dates
        </button>
        {months.length === 1 && <Link href={reset}>This month and next</Link>}
      </form>
      <p>
        Each fare is a return price for one adult, doubled. We allow €20 or 10%
        of the airfare as a reserve, whichever is higher. Rooms, meals and
        transport still come out of your budget. Destinations are ordered and
        filtered by airfare plus that reserve, not by total trip cost. Appearing
        here does not mean the whole trip fits. Check the price and two-seat
        availability with the provider. Each destination also shows what is left
        after the costs we can source: city tax, and the airport transfer where
        we have its fare. A cost we cannot source is named as not known or not
        counted, never counted as zero.
      </p>
      {live === undefined && (
        <p role="status">
          The fare database is unavailable. Only still-current fares from our
          last check can be shown.
        </p>
      )}
      {/* A length this origin doesn't collect has nothing to list: the notice
          above says so, rather than an empty month that reads like no fares. */}
      {(notCollected === undefined ? months : []).map((month) => {
        const cities = monthDestinations(
          rows,
          month,
          today,
          now.getTime(),
          ceiling,
          nights,
        );
        const count = cities.length;
        const name = monthName(month);
        const otherMonth = months.find((m) => m !== month);
        const multi = cities.filter((c) => c.options.length > 1).length;
        return (
          <section
            id={"depart-" + month}
            key={month}
            aria-label={name}
            className="month-results"
          >
            <h2>{name}</h2>
            {live !== undefined &&
              health[month] &&
              health[month] !== "current" && (
                <p className="month-notice" role="status">
                  {health[month] === "failed"
                    ? "We couldn’t finish checking fares"
                    : health[month] === "overdue"
                      ? "Our fare update is overdue"
                      : "We couldn’t verify the fare update"}{" "}
                  for {name} from {origin.name}. We only show fares seen in the
                  past seven days. More destinations or dates may be available.
                </p>
              )}
            {count >= minimumComparisonCities ? (
              <p>
                {count} destinations · {multi} with more than one departure date
              </p>
            ) : live === undefined && count === 0 ? (
              <p>
                Coverage from {origin.name} for {name} is unavailable. Try again
                later.
              </p>
            ) : (
              <div className="month-notice">
                <p>
                  {count
                    ? `From ${origin.name}, we’ve seen ${length} returns within your flight allowance to only ${count === 1 ? "one destination" : "two destinations"} for ${name}. You can check those dates below or choose another month for a wider comparison.`
                    : `We haven’t seen a ${length} return from ${origin.name} for ${name} at this budget in the past seven days. Try a higher budget or another month. Other flights may be available.`}
                </p>
                {!otherMonth ? (
                  <Link href={reset}>Compare this month and next</Link>
                ) : (
                  <a href={"#depart-" + otherMonth}>
                    See {monthName(otherMonth)}
                  </a>
                )}
              </div>
            )}
            <div className="month-cities">
              {cities.map(({ destination, options }) => {
                const place = monthPlace(destination);
                if (!place)
                  return (
                    <article key={destination}>
                      <h3>{destination}</h3>
                      <p>
                        Destination details are being checked. Room search is
                        unavailable until the city is identified.
                      </p>
                    </article>
                  );
                return (
                  <MonthDestinationCard
                    key={`${month}-${destination}`}
                    originCode={origin.code}
                    attractionsByDeparture={Object.fromEntries(
                      options.map((o): [string, StayAttraction[]] => [
                        o.departure,
                        attractionsForStay({
                          records: attractionRecords,
                          city: destination,
                          checkIn: o.departure,
                          checkOut: o.returning,
                          now: now.getTime(),
                        }),
                      ]),
                    )}
                    budgetLeftByDeparture={Object.fromEntries(
                      options.map((o): [string, BudgetLeft] => [
                        o.departure,
                        budgetLeft({
                          budgetCents: ceiling * 100,
                          flightPartyCents: o.partyCents,
                          flightObservedAt: o.observedAt,
                          city: destination,
                          arrivalAirport: o.airport,
                          checkIn: o.departure,
                          checkOut: o.returning,
                          hotelClass,
                          foodPerDayCents:
                            foodEuros === undefined
                              ? undefined
                              : foodEuros * 100,
                          cityTaxes: cityTaxRecords,
                          transfers: airportTransferRecords,
                          fx: fxData.records[0],
                          now: now.getTime(),
                        }),
                      ]),
                    )}
                    city={place.name}
                    country={place.country}
                    options={options}
                    budget={ceiling}
                    asOf={now.getTime()}
                    evidence={roomEvidence(
                      destination,
                      place.countryCode,
                      today,
                      publishedRooms,
                      reviewedStayData,
                      place.name,
                    )}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
      {questions && (
        <section>
          <h2>About these fares</h2>
          {questions.map((q) => (
            <details key={q.question}>
              <summary>{q.question}</summary>
              <p>{q.answer}</p>
            </details>
          ))}
          <Link href="/methodology">How we measure fares</Link>
        </section>
      )}
      {customPlannerEnabled && (
        <Link href="/plan?mode=custom">
          Plan a trip with different dates or travellers
        </Link>
      )}
    </main>
  );
}
