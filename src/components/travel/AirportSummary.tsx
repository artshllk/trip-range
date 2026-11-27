import { ParameterNote } from "./ParameterNote";
import { departureTransfer } from "../../domain/costs/planning-parameters";
import { planDerived, planningEstimate } from "../../domain/money/provenance";
import type { TripPlan } from "@/domain/types";
import type { Dictionary } from "@/i18n/dictionaries";
import { formatMoney, type Locale } from "@/i18n/config";
export function AirportSummary({
  plan,
  locale,
  t,
  detail = false,
}: {
  plan: TripPlan;
  locale: Locale;
  t: Dictionary;
  detail?: boolean;
}) {
  const departure = plan.departure;
  if (plan.transportMode !== "flight" || !departure) return null;
  const transfer = departure.transfer;
  return (
    <div className="small stack">
      <p>
        <b>
          {t.departureAirport}: {departure.code}
        </b>
        {departure.selected ? ` · ${t.selectedAirport}` : ""}
      </p>
      {transfer ? (
        <p className="muted">
          {transfer.origin.name} → {transfer.departureAirport.name}
          <br />≈ {formatMoney(planningEstimate(transfer.amount), locale)} · ≈{" "}
          {Math.floor(transfer.durationMinutes / 60)}h{" "}
          {transfer.durationMinutes % 60}m · {t.tripRangeEstimate}
          {detail ? (
            <>
              <br />
              {t.transferAssumption}
            </>
          ) : null}
          <br />
          <ParameterNote
            parameter={departureTransfer}
            kind="transfer"
            amount={transfer.amount}
            locale={locale}
          />
        </p>
      ) : null}
      {plan.airportSavingCents ? (
        <p className="ember-text">
          {t.afterTransfer.replace(
            "{amount}",
            formatMoney(
              planDerived(
                {
                  cents: plan.airportSavingCents,
                  currency: plan.request.budget.currency,
                },
                plan,
              ),
              locale,
            ),
          )}
        </p>
      ) : null}
    </div>
  );
}
