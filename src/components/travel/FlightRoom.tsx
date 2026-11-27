import { planDerived, requestBudget } from "../../domain/money/provenance";
import { flightRoom } from "../../domain/flight-room";
import type { MoneyAmount, TripPlan } from "../../domain/types";
import { formatMoney, type Locale } from "../../i18n/config";
import { localized } from "../../i18n/localized";
import { flightRoomCopy } from "../../i18n/flight-room";
import { costEstimateLabel } from "../../i18n/cost-provenance";
import { stayBasisText } from "../../i18n/stay-basis";

/** Display only: whole €5 steps, outward, so the shown range never narrows the band. */
function roundOutward(
  amount: MoneyAmount,
  direction: "down" | "up",
): MoneyAmount {
  const step = 500;
  const cents =
    (direction === "down" ? Math.floor : Math.ceil)(amount.cents / step) * step;
  return { ...amount, cents };
}

/** Flights unpriced: known costs, the gap, and what the budget leaves. Never a fare. */
export function FlightRoom({
  plan,
  locale,
}: {
  plan: TripPlan;
  locale: Locale;
}) {
  const room = flightRoom(plan);
  if (!room) return null;
  const copy = localized(flightRoomCopy, locale);
  const budget = requestBudget(plan.request);
  const party =
    room.people === 1
      ? copy.person
      : copy.people.replace("{n}", String(room.people));
  const share = (cents: number) =>
    `${Math.min(100, (cents / Math.max(1, budget.cents)) * 100)}%`;
  return (
    <div className="result-price flight-room" data-room={room.status}>
      <dl className="flight-room-rows">
        <div>
          <dt>{copy.budget}</dt>
          <dd>{formatMoney(budget, locale)}</dd>
        </div>
        <div>
          <dt>{copy.costs}</dt>
          <dd>
            ≈{" "}
            {room.knownRange
              ? copy.range
                  .replace(
                    "{low}",
                    formatMoney(
                      planDerived(
                        roundOutward(room.knownRange.low, "down"),
                        plan,
                      ),
                      locale,
                    ),
                  )
                  .replace(
                    "{high}",
                    formatMoney(
                      planDerived(
                        roundOutward(room.knownRange.high, "up"),
                        plan,
                      ),
                      locale,
                    ),
                  )
              : formatMoney(planDerived(room.known, plan), locale)}{" "}
            <small className="flight-room-tag">{copy.estimate}</small>
          </dd>
        </div>
        <div>
          <dt>{copy.flights}</dt>
          <dd className="flight-room-unpriced">{copy.notPriced}</dd>
        </div>
      </dl>
      {room.status === "room" ? (
        <>
          <div className="flight-room-leaves">
            <p>
              <b>
                {copy.findFlights.replace(
                  "{amount}",
                  formatMoney(planDerived(room.upTo, plan, true), locale),
                )}
              </b>
            </p>
            <span className="flight-room-per-person">
              {copy.forParty.replace("{people}", party)}
              {room.perPerson
                ? ` · ${copy.perPerson.replace(
                    "{amount}",
                    formatMoney(
                      planDerived(room.perPerson, plan, true),
                      locale,
                    ),
                  )}`
                : null}
            </span>
          </div>
          <div className="flight-room-bar" aria-hidden="true">
            <span
              className="known"
              style={{ width: share(room.known.cents) }}
            />
            <span
              className="reserve"
              style={{ width: share(room.reserve.cents) }}
            />
            <span
              className="room"
              style={{ width: share(room.ceiling.cents) }}
            />
          </div>
          <p className="flight-room-legend" aria-hidden="true">
            <span className="known">{copy.legendKnown}</span>
            <span className="reserve">{copy.legendReserve}</span>
            <span className="room">{copy.legendRoom}</span>
          </p>
          <p className="small muted">{copy.limitNote}</p>
        </>
      ) : (
        <p className="small result-known-over">{copy.noRoom}</p>
      )}
      <p className="small muted cost-estimate-label">
        {costEstimateLabel(plan.costIntegrity, locale)}
      </p>
      {/* A reviewed figure is named beside the card by PanelTaxNotice; without one, say so here. */}
      {!plan.lodgingTax && stayBasisText(plan, locale) ? (
        <p className="small muted stay-basis">{stayBasisText(plan, locale)}</p>
      ) : null}
    </div>
  );
}
