"use client";
import { fareFreshness } from "../../domain/money/freshness";
import {
  quoteMoney,
  AVIASALES_DATA_PROVIDER,
} from "../../domain/money/provenance";
import { useState } from "react";
import { TripCostCard } from "../travel/TripCostCard";
import { MonthFlightCheck } from "./MonthFlightCheck";
import type { MonthFare } from "../../domain/month-discovery";
import type { RoomEvidence } from "../../domain/room-evidence";
import { roomEuros } from "../../domain/room-evidence";
import type { BudgetLeft } from "../../domain/budget-left";
import { BudgetLeftPanel } from "./BudgetLeftPanel";
import type { StayAttraction } from "../../domain/attractions";

export function MonthDestinationCard({
  originCode,
  budgetLeftByDeparture,
  attractionsByDeparture,
  city,
  country,
  options,
  evidence,
  budget,
  asOf,
}: {
  /** City-market code of the chosen origin (TIA, LON, BCN, WAW). */
  originCode: string;
  /** What is left of the budget for each departure option, computed on the server. */
  budgetLeftByDeparture: Record<string, BudgetLeft>;
  /** Official sight prices for the stay, computed on the server. */
  attractionsByDeparture?: Record<string, StayAttraction[]>;
  city: string;
  country: string;
  options: MonthFare[];
  evidence: RoomEvidence;
  budget: number;
  asOf: number;
}) {
  const cheapest = options.reduce((a, b) =>
    a.partyCents <= b.partyCents ? a : b,
  );
  const [departure, setDeparture] = useState(cheapest.departure);
  const fare = options.find((o) => o.departure === departure) ?? cheapest;
  const left = budgetLeftByDeparture[fare.departure];

  return (
    <article className="month-destination">
      <h3>{city}</h3>
      <p>
        {options.length}{" "}
        {options.length === 1 ? "departure date" : "departure dates"} · return
        flights from {roomEuros(cheapest.partyCents)} for two
      </p>
      <label className="month-date-choice">
        Choose your dates
        <select
          value={fare.departure}
          onChange={(e) => setDeparture(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.departure} value={o.departure}>
              {o.departure}–{o.returning} · {o.originAirport ?? originCode} ↔{" "}
              {o.airport} · {roomEuros(o.partyCents)} flights for two
            </option>
          ))}
        </select>
      </label>
      <TripCostCard
        city={city}
        country={country}
        evidence={evidence}
        observedAt={fare.observedAt}
        costs={{
          flightCents: fare.partyCents,
          budgetCents: budget * 100,
          checkIn: fare.departure,
          checkOut: fare.returning,
          adults: 2,
          rooms: 1,
        }}
        separateCostsNote={false}
      >
        {left && (
          <BudgetLeftPanel
            result={left}
            attractions={attractionsByDeparture?.[fare.departure]}
          />
        )}
      </TripCostCard>
      <MonthFlightCheck
        route={{
          // The airport the fare actually departs from, so the provider search
          // reproduces it; the city market when the provider did not state one.
          originCode: fare.originAirport ?? originCode,
          destinationCode: fare.airport,
          departureDate: fare.departure,
          returnDate: fare.returning,
          party: { adults: 2, children: 0 },
        }}
        fareAge={
          fareFreshness(
            quoteMoney({
              amount: { cents: fare.partyCents, currency: "EUR" },
              demo: false,
              confidence: "recent",
              providerId: AVIASALES_DATA_PROVIDER,
              observedAt: fare.observedAt,
            }),
            asOf,
          )?.tier ?? "unknown"
        }
      />
      <p className="small muted">
        Aviasales checks flights; Booking.com checks rooms. Trip Range may earn
        a commission from flight bookings, at no extra cost to you.
      </p>
    </article>
  );
}
