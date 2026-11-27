import { planDerived } from "../../domain/money/provenance";
import { matchingFlight } from "../../domain/flight-pricing";
import type { UnpricedTripPlan } from "../../domain/types";
import type { Dictionary } from "../../i18n/dictionaries";
import { formatMoney, type Locale } from "../../i18n/config";
import { flightAffordabilityText } from "../../i18n/flight-affordability";
import { resultsCopy } from "../../i18n/results";
import { costEstimateLabel } from "../../i18n/cost-provenance";
import {
  AccommodationChargeNotice,
  ConditionalPropertyTotal,
} from "./AccommodationChargeNotice";

/** Shared incomplete-price presentation. No partial amount is a whole-trip total. */
export function TripUnpricedSummary({
  plan,
  locale,
}: {
  plan: UnpricedTripPlan;
  locale: Locale;
  t: Dictionary;
}) {
  const copy = resultsCopy[locale];
  if (
    plan.pricingCompleteness === "property-charges-conditional" ||
    plan.pricingCompleteness === "fit-unconfirmed"
  )
    return <ConditionalPropertyTotal plan={plan} locale={locale} />;
  const chargesMissing =
    plan.pricingCompleteness === "accommodation-charges-unpriced";
  const stayMissing = plan.pricingCompleteness === "stay-unpriced";
  const transferMissing =
    plan.pricingCompleteness === "required-transfer-unpriced";
  const reason = stayMissing
    ? copy.missingStay
    : transferMissing
      ? matchingFlight(plan)
        ? copy.missingTransfer
        : copy.missingFlightAndTransfer
      : copy.incompleteFlight;
  return (
    <div className="stack trip-unpriced-summary result-price-unpriced">
      <p className="result-price-status trip-unpriced-status">
        {copy.incomplete}
      </p>
      {chargesMissing ? (
        <>
          <AccommodationChargeNotice plan={plan} locale={locale} />
          {plan.transportMode === "flight" && !matchingFlight(plan) ? (
            <p className="small muted">{copy.missingFlight}</p>
          ) : null}
        </>
      ) : (
        <p className={`small muted${stayMissing ? " stay-unavailable" : ""}`}>
          {reason}
        </p>
      )}
      {!chargesMissing ? (
        <AccommodationChargeNotice plan={plan} locale={locale} />
      ) : null}
      {!stayMissing ? (
        <dl className="result-price-rows">
          <div>
            <dt>
              {transferMissing || chargesMissing
                ? copy.knownCosts
                : copy.otherCosts}
            </dt>
            <dd className="result-partial">
              ≈{" "}
              {formatMoney(
                planDerived(
                  transferMissing || chargesMissing
                    ? plan.knownCosts
                    : plan.knownNonFlightCosts,
                  plan,
                ),
                locale,
              )}
            </dd>
          </div>
        </dl>
      ) : null}
      <p className="small muted cost-estimate-label">
        {costEstimateLabel(plan.costIntegrity, locale)}
      </p>
      {plan.flightAffordability.status === "calculated" ? (
        <details className="flight-budget-disclosure small">
          <summary>
            {copy.ceilingHelp}
            <span aria-hidden="true">+</span>
          </summary>
          <div className="stack">
            <p>
              {copy.ceiling}:{" "}
              <b>
                ≤{" "}
                {formatMoney(
                  planDerived(plan.flightAffordability.ceiling, plan, true),
                  locale,
                )}
              </b>
            </p>
            <p>
              {copy.ceilingNote} {copy.buffer}
            </p>
          </div>
        </details>
      ) : plan.flightAffordability.status === "no-room-in-budget" ? (
        <p className="small muted">
          {flightAffordabilityText(
            plan.flightAffordability,
            plan.request.budget,
            locale,
          )}
        </p>
      ) : null}
    </div>
  );
}
