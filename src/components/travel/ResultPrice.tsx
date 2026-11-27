import { PlanTripCost } from "./PlanTripCost";
import { planDerived } from "../../domain/money/provenance";
import { completePlan, matchingFlight } from "../../domain/flight-pricing";
import type { TripPlan } from "../../domain/types";
import { formatMoney, type Locale } from "../../i18n/config";
import type { Dictionary } from "../../i18n/dictionaries";
import { resultsCopy } from "../../i18n/results";
import { FareContext } from "./Provenance";
import { FlightRoom } from "./FlightRoom";
import {
  AccommodationChargeNotice,
  ConditionalPropertyTotal,
} from "./AccommodationChargeNotice";
import { costEstimateLabel } from "../../i18n/cost-provenance";

type PriceProps = { plan: TripPlan; locale: Locale; t: Dictionary };
/** Presentation only: never derives a fare or a budget from reference prices. */
export function ResultPrice({ plan, locale, t }: PriceProps) {
  if (plan.transportMode === "flight") return <PlanTripCost plan={plan} />;
  const copy = resultsCopy[locale];
  const fare = matchingFlight(plan);
  if (
    plan.pricingCompleteness === "property-charges-conditional" ||
    plan.pricingCompleteness === "fit-unconfirmed"
  )
    return <ConditionalPropertyTotal plan={plan} locale={locale} />;
  if (completePlan(plan))
    return (
      <div className="result-price result-price-complete">
        <p className="small muted">
          {t.budgetNeeded} ·{" "}
          {plan.request.party.adults + plan.request.party.children} {t.people}
        </p>
        <div className="total">
          <strong>
            {formatMoney(planDerived(plan.budget.budgetNeeded, plan), locale)}
          </strong>
          <span className="small muted">
            {" "}
            {locale === "en" ? "including reserve" : t.safetyBuffer}
          </span>
        </div>
        <p className="small muted cost-estimate-label">
          {costEstimateLabel(plan.costIntegrity, locale)}
        </p>
        <p
          className={`result-balance ${plan.budget.fit === "over" ? "result-over" : "result-fits"}`}
        >
          <b>
            {formatMoney(
              planDerived(
                plan.budget.fit === "over"
                  ? plan.budget.overBudget
                  : plan.budget.remainingAfterReserve,
                plan,
                true,
              ),
              locale,
            )}
          </b>{" "}
          {plan.budget.fit === "over" ? t.over : copy.reserve}
        </p>
        <p className="small muted result-confidence">
          {fare
            ? copy.recent
            : plan.costs.some((c) => c.demo)
              ? copy.demo
              : copy.estimated}
        </p>
        {fare ? (
          <p className="small muted">
            <FareContext fare={fare} locale={locale} />
          </p>
        ) : null}
      </div>
    );
  if (plan.pricingCompleteness === "flight-unpriced")
    return <FlightRoom plan={plan} locale={locale} />;
  const stayMissing = plan.pricingCompleteness === "stay-unpriced";
  const chargesMissing =
    plan.pricingCompleteness === "accommodation-charges-unpriced";
  return (
    <div className="result-price result-price-unpriced">
      <p className="result-total-unknown">
        {locale === "en" ? "Trip total not yet known" : copy.incomplete}
      </p>
      {!stayMissing ? (
        <p className="result-partial small">
          ≈ {formatMoney(planDerived(plan.knownCosts, plan), locale)}{" "}
          {copy.knownCosts.toLowerCase()}
        </p>
      ) : null}
      {chargesMissing ? (
        <>
          <AccommodationChargeNotice plan={plan} locale={locale} />
          {!fare ? <p className="small muted">{copy.missingFlight}</p> : null}
        </>
      ) : (
        <p className={`small muted${stayMissing ? " stay-unavailable" : ""}`}>
          {stayMissing
            ? copy.missingStay
            : matchingFlight(plan)
              ? copy.missingTransfer
              : copy.missingFlightAndTransfer}
        </p>
      )}
      {!chargesMissing ? (
        <AccommodationChargeNotice plan={plan} locale={locale} />
      ) : null}
      <p className="small muted cost-estimate-label">
        {costEstimateLabel(plan.costIntegrity, locale)}
      </p>
    </div>
  );
}
