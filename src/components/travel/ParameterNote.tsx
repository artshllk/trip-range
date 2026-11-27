import {
  parameterRange,
  type PlanningParameter,
} from "../../domain/costs/planning-parameters";
import { planningEstimate } from "../../domain/money/provenance";
import type { MoneyAmount } from "../../domain/money/currency";
import { formatMoney, type Locale } from "../../i18n/config";
import { localized } from "../../i18n/localized";
import { planningParameterCopy } from "../../i18n/planning-parameters";

/** Visible basis, as-of date and (once documented) range for a hand-set estimate. */
export function ParameterNote({
  parameter,
  kind,
  amount,
  locale,
}: {
  parameter: PlanningParameter;
  kind: "stay" | "transfer";
  amount: MoneyAmount;
  locale: Locale;
}) {
  const copy = localized(planningParameterCopy, locale);
  const date = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${parameter.asOf}T00:00:00Z`));
  const range = parameterRange(amount.cents, parameter);
  return (
    <span className="parameter-note">
      {copy[kind].replace("{date}", date)}
      {range ? (
        <>
          {" "}
          {copy.range
            .replace(
              "{low}",
              formatMoney(
                planningEstimate({
                  cents: range.low,
                  currency: amount.currency,
                }),
                locale,
              ),
            )
            .replace(
              "{high}",
              formatMoney(
                planningEstimate({
                  cents: range.high,
                  currency: amount.currency,
                }),
                locale,
              ),
            )}
        </>
      ) : null}
    </span>
  );
}
