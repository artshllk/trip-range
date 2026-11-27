import type { ReactNode } from "react";
import { BookingSearchLink } from "./BookingSearchLink";
import { RoomEvidence } from "./RoomEvidence";
import { stayDateLabel } from "../../domain/dates";
import {
  tripCostVerdict,
  roomEuros,
  type RoomEvidence as Evidence,
  type TripCostInput,
} from "../../domain/room-evidence";

export function TripCostCard({
  city,
  country,
  evidence,
  costs,
  observedAt,
  children,
  separateCostsNote = true,
}: {
  city: string;
  country: string;
  evidence: Evidence;
  costs: TripCostInput;
  observedAt?: string;
  /** Rendered after the fare line, before room evidence (the budget-left panel). */
  children?: ReactNode;
  /** The generic "allow separately" line; off when a budget-left panel names costs. */
  separateCostsNote?: boolean;
}) {
  const verdict = tripCostVerdict(evidence, costs);
  const flight =
    costs.flightCents === undefined
      ? undefined
      : new Intl.NumberFormat("en-IE", {
          style: "currency",
          currency: costs.flightCurrency ?? "EUR",
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        }).format(costs.flightCents / 100);
  return (
    <section className="trip-cost-card" aria-label={`${city} trip costs`}>
      <p className="trip-flight-headline">
        <strong>
          {flight ? `Flights ${flight} return` : "Check return flights"} for{" "}
          {costs.adults === 2 ? "two" : `${costs.adults} adults`}
          {costs.children ? ` and ${costs.children} children` : ""}
        </strong>
        {" · "}
        {stayDateLabel(costs.checkIn, costs.checkOut)}
      </p>
      {observedAt && (
        <p className="small muted">
          Fare seen by provider{" "}
          <time dateTime={observedAt}>{observedAt.slice(0, 10)}</time>. Check
          price and availability with Aviasales.
        </p>
      )}
      {children}
      <RoomEvidence
        evidence={evidence}
        checkIn={costs.checkIn}
        checkOut={costs.checkOut}
      />
      {costs.otherCosts && (
        <dl className="trip-cost-lines">
          <div>
            <dt>Food</dt>
            <dd>{roomEuros(costs.otherCosts.foodCents)}</dd>
          </div>
          <div>
            <dt>Airport transfers and local transport</dt>
            <dd>{roomEuros(costs.otherCosts.transportCents)}</dd>
          </div>
          <div>
            <dt>Extra charges</dt>
            <dd>{roomEuros(costs.otherCosts.chargesCents)}</dd>
          </div>
          <div>
            <dt>Reserve</dt>
            <dd>{roomEuros(costs.otherCosts.reserveCents)}</dd>
          </div>
        </dl>
      )}
      {verdict.low !== undefined && (
        <>
          <p className="trip-cost-total">
            {verdict.basis === "measured"
              ? "Trip costs across checked rooms"
              : "Approximate trip cost"}
            :{" "}
            {verdict.low === verdict.high
              ? `About ${roomEuros(verdict.low)}`
              : `${roomEuros(verdict.low)}–${roomEuros(verdict.high!)}`}
          </p>
          <p className="trip-cost-verdict" data-verdict={verdict.basis}>
            {verdict.text}
          </p>
        </>
      )}
      <BookingSearchLink
        city={city}
        country={country}
        checkIn={costs.checkIn}
        checkOut={costs.checkOut}
        adults={costs.adults}
        childCount={costs.children}
      />
      {!costs.otherCosts && separateCostsNote && (
        <p className="small muted">
          Allow separately for meals, airport transfers, local transport and
          extra charges.
        </p>
      )}
    </section>
  );
}
