import { ParameterNote } from "./ParameterNote";
import {
  departureTransfer,
  stayBaseline,
} from "../../domain/costs/planning-parameters";
import { localized } from "../../i18n/localized";
import {
  requestBudget,
  planDerived,
  quoteMoney,
} from "../../domain/money/provenance";
import { stayCopy } from "../../i18n/accommodation";
import { StayEvidenceDetails } from "./StayEvidence";
import { gatewayCopy } from "./GatewaySummary";
import {
  costBasisText,
  costIntegrityText,
  costComponentText,
} from "../../i18n/cost-provenance";
import { completePlan } from "../../domain/flight-pricing";
import { TripUnpricedSummary } from "./TripUnpricedSummary";
import type { UnpricedTripPlan } from "../../domain/types";
import type { TripPlan, PriceConfidence } from "../../domain/types";
import type { Dictionary } from "../../i18n/dictionaries";
import { formatMoney, type Locale } from "../../i18n/config";
import { provenanceLabel } from "../../i18n/provenance-labels";
export function PriceMark({
  confidence,
  demo = true,
  t,
}: {
  confidence: PriceConfidence;
  demo?: boolean;
  t: Dictionary;
}) {
  return (
    <span
      className={`price-mark ${confidence}`}
      title={!demo && confidence === "recent" ? t.recentFare : t[confidence]}
      aria-label={
        !demo && confidence === "recent" ? t.recentFare : t[confidence]
      }
    >
      {confidence === "recent" ? "◷" : "≈"}
    </span>
  );
}
export function BudgetBar({ plan }: { plan: TripPlan }) {
  if (!completePlan(plan)) return null;
  return (
    <div className="budget-bar" aria-hidden="true">
      {plan.costs.map((c) => (
        <span
          key={c.category}
          className={`cost-${c.category}`}
          style={{
            width: `${(c.amount.cents / Math.max(plan.request.budget.cents, plan.budget.budgetNeeded.cents)) * 100}%`,
          }}
        />
      ))}
      <span
        className="cost-buffer"
        style={{
          width: `${(plan.safetyBuffer.cents / Math.max(plan.request.budget.cents, plan.budget.budgetNeeded.cents)) * 100}%`,
        }}
      />
    </div>
  );
}
export function CostRows({
  plan,
  locale,
  t,
}: {
  plan: TripPlan;
  locale: Locale;
  t: Dictionary;
}) {
  return (
    <dl className="cost-rows">
      {plan.costs.map((c) => (
        <div key={c.category}>
          <dt>
            <i className={`cost-${c.category}`} />
            {t[c.category]}
            <small
              className={`money-provenance ${quoteMoney(c).provenance.kind}`}
            >
              {
                localized(provenanceLabel, locale)[
                  quoteMoney(c).provenance.kind
                ]
              }
            </small>
            {c.planning?.length ? (
              <span className="sr-only">
                {" "}
                ·{" "}
                {[
                  ...new Set(
                    c.planning.map((p) => costBasisText(p.basis, locale)),
                  ),
                ].join("; ")}
              </span>
            ) : null}
          </dt>
          <dd>
            {c.category === "stay" ? (
              <span
                className={`price-mark ${c.confidence}`}
                title={
                  stayCopy[locale][
                    plan.accommodation?.kind === "provider-priced"
                      ? "provider-priced"
                      : plan.accommodation?.kind === "reviewed-estimate"
                        ? "reviewed-estimate"
                        : "generic-estimate"
                  ]
                }
              >
                {c.confidence === "recent" ? "◷" : "≈"}
              </span>
            ) : (
              <PriceMark demo={c.demo} confidence={c.confidence} t={t} />
            )}
            {formatMoney(quoteMoney(c), locale)}
            {c.category === "stay" &&
            c.planning?.some((p) => p.basis === "curated-legacy") ? (
              <ParameterNote
                parameter={stayBaseline}
                kind="stay"
                amount={c.amount}
                locale={locale}
              />
            ) : c.planning?.some((p) => p.component === "departureTransfer") ? (
              <ParameterNote
                parameter={departureTransfer}
                kind="transfer"
                amount={c.amount}
                locale={locale}
              />
            ) : null}
          </dd>
        </div>
      ))}
      {completePlan(plan) ? (
        <>
          {" "}
          <div>
            <dt>{t.estimatedSpend}</dt>
            <dd>
              {formatMoney(
                planDerived(plan.budget.estimatedSpend, plan),
                locale,
              )}
            </dd>
          </div>
          <div>
            <dt>
              <i className="cost-buffer" />
              {t.safetyBuffer}
            </dt>
            <dd>{formatMoney(planDerived(plan.safetyBuffer, plan), locale)}</dd>
          </div>
          <div>
            <dt>{t.budgetNeeded}</dt>
            <dd>
              {formatMoney(planDerived(plan.budget.budgetNeeded, plan), locale)}
            </dd>
          </div>
        </>
      ) : (
        <div>
          <dt>
            {plan.pricingCompleteness !== "flight-unpriced"
              ? gatewayCopy[locale].known
              : t.otherCosts}
          </dt>
          <dd>
            ≈{" "}
            {formatMoney(
              planDerived(
                plan.pricingCompleteness !== "flight-unpriced"
                  ? plan.knownCosts
                  : plan.knownNonFlightCosts,
                plan,
              ),
              locale,
            )}
          </dd>
        </div>
      )}
    </dl>
  );
}
export function CostProvenance({
  plan,
  locale,
}: {
  plan: TripPlan;
  locale: Locale;
}) {
  const components = plan.costs.flatMap((c) => c.planning ?? []);
  return (
    <div className="cost-provenance stack">
      <StayEvidenceDetails plan={plan} locale={locale} />
      <p className="small muted">
        {costIntegrityText(plan.costIntegrity, locale)}
      </p>
      <details className="small muted">
        <summary>
          {locale === "sq" ? "Baza e vlerësimeve" : "Estimate assumptions"}
        </summary>
        <ul>
          {components.map((p) => (
            <li key={p.component}>
              <b>{costComponentText(p.component, locale)}</b> ·{" "}
              {costBasisText(p.basis, locale)}:{" "}
              {p.basket?.[locale] ??
                (p.basis === "provider-availability"
                  ? locale === "sq"
                    ? "Tarifë për datat dhe udhëtarët; përfshin tarifat e detyrueshme të njohura."
                    : "Rate for these dates and guests, including known mandatory charges."
                  : locale === "sq"
                    ? "Shumë e përgjithshme ose e mëparshme; kontrollo kostot për planet e tua."
                    : "General or earlier allowance; check costs for your own plans.")}
              {p.transfer ? (
                <span>
                  {" "}
                  {locale === "sq"
                    ? "Dy tarifa njëdrejtimëshe për të rritur për çdo udhëtar, edhe fëmijët; pa ulje për fëmijë. "
                    : "Two adult one-way fares for every traveller, including children; no child discounts assumed. "}
                  <a
                    href={p.transfer.observation.source.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {locale === "sq"
                      ? "Burimi i operatorit"
                      : "Operator source"}
                  </a>
                  {" · "}
                  {locale === "sq" ? "kontrolluar" : "checked"}{" "}
                  <time dateTime={p.transfer.observation.observedAt}>
                    {p.transfer.observation.observedAt.slice(0, 10)}
                  </time>
                  {". "}
                  {locale === "sq"
                    ? "Kurs reference ECB"
                    : "ECB reference conversion"}{" "}
                  <time dateTime={p.transfer.fx.sourceDate}>
                    {p.transfer.fx.sourceDate}
                  </time>
                  {locale === "sq"
                    ? "; vlerësim planifikimi, jo çmim i garantuar."
                    : "; a planning estimate, not a guaranteed fare."}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        <p>
          {locale === "sq"
            ? "Udhëtimi yt drejt aeroportit të nisjes nuk përfshihet, përveç një transferi nisjeje të treguar veç. Bagazhi i zgjedhur mbetet vlerësim i përgjithshëm. Qëndrimi është vlerësim, jo inventar për rezervim. Ushqimi është një shportë ilustruese planifikimi; kostot përfundimtare mund të ndryshojnë."
            : "Your journey to the departure airport is excluded unless a departure transfer is listed separately. Selected baggage remains a generic estimate. Stay is an estimate, not bookable inventory. Meals are an illustrative planning basket; final costs can differ."}
        </p>
      </details>
    </div>
  );
}
export function BudgetPanel({
  plan,
  locale,
  t,
}: {
  plan: TripPlan;
  locale: Locale;
  t: Dictionary;
}) {
  if (!completePlan(plan))
    return (
      <>
        <UnpricedSummary plan={plan} locale={locale} t={t} />
        <CostRows plan={plan} locale={locale} t={t} />
        <CostProvenance plan={plan} locale={locale} />
      </>
    );
  return (
    <>
      <div className="row-between">
        <span className="eyebrow">{t.estimatedSpend}</span>
        <span className={`fit ${plan.budget.fit}`}>{t[plan.budget.fit]}</span>
      </div>
      <div className="total">
        <strong>
          {formatMoney(planDerived(plan.budget.estimatedSpend, plan), locale)}
        </strong>
      </div>
      <p className="muted small">
        {plan.request.party.adults + plan.request.party.children} {t.people}
      </p>
      <p className="small">
        {t.safetyBuffer}:{" "}
        {formatMoney(planDerived(plan.safetyBuffer, plan), locale)}
      </p>
      <p>
        <b>
          {t.budgetNeeded}:{" "}
          {formatMoney(planDerived(plan.budget.budgetNeeded, plan), locale)}
        </b>{" "}
        / {formatMoney(requestBudget(plan.request), locale)}
      </p>
      <BudgetBar plan={plan} />
      <p className={plan.budget.fit === "over" ? "over-text" : ""}>
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
        {plan.budget.fit === "over" ? t.over : t.left}
      </p>
      <CostRows plan={plan} locale={locale} t={t} />
      <CostProvenance plan={plan} locale={locale} />
      <p className="notice good">
        ✓ {formatMoney(planDerived(plan.safetyBuffer, plan), locale)} {t.buffer}
      </p>
    </>
  );
}
export function PriceLegend({
  t,
  hybrid = false,
}: {
  t: Dictionary;
  hybrid?: boolean;
}) {
  return (
    <div className="price-legend">
      {(["recent", "estimate"] as const).map((c) => (
        <span key={c}>
          <PriceMark demo={!hybrid} confidence={c} t={t} />
          {hybrid && c === "recent" ? t.recentFare : t[c]}
        </span>
      ))}
    </div>
  );
}

export function UnpricedSummary({
  plan,
  locale,
  t,
}: {
  plan: UnpricedTripPlan;
  locale: Locale;
  t: Dictionary;
}) {
  return <TripUnpricedSummary plan={plan} locale={locale} t={t} />;
}
