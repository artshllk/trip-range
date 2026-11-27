import { localePath } from "@/i18n/routing";
import { planDerived } from "../../domain/money/provenance";
import { completePlan } from "@/domain/flight-pricing";
import { aiCopy } from "@/i18n/ai";
import { AirportSummary } from "./AirportSummary";
import { ImageAttribution, TripProvenance } from "./Provenance";
import {
  DestinationImage,
  ImageAssetBoundary,
  WhenDestinationPhoto,
} from "./DestinationImage";
import Link from "next/link";
import type { TripPlan } from "@/domain/types";
import type { Dictionary } from "@/i18n/dictionaries";
import { formatMoney, type Locale } from "@/i18n/config";
import { requestQuery } from "@/domain/request";
import { BudgetBar, CostRows, UnpricedSummary } from "./Budget";
import { FlightAffiliateCTA } from "./FlightAffiliateCTA";
import { PlanTripCost } from "./PlanTripCost";
export function TripCard({
  plan,
  locale,
  t,
  index = 0,
  explanation,
  headingLevel = 2,
}: {
  plan: TripPlan;
  locale: Locale;
  t: Dictionary;
  index?: number;
  explanation?: string;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const flying = plan.transportMode === "flight";
  return (
    <article className="trip-card">
      <div className="card-photo">
        <ImageAssetBoundary
          destination={plan.destination}
          locale={locale}
          image={plan.destination.image}
          fallback={plan.destination.fallbackImage}
        >
          <DestinationImage
            fallbackAlt={t.photo}
            fill
            loading={index === 0 ? "eager" : "lazy"}
            sizes="(min-width: 900px) 33vw, 100vw"
          />
          <span className="photo-tag">
            {flying || !completePlan(plan)
              ? t.moreTripIdeas
              : index === 0
                ? t.bestValue
                : index === 1
                  ? t.ourPick
                  : t.thirdPick}
          </span>
          <WhenDestinationPhoto>
            <span className="photo-caption">
              <ImageAttribution t={t} />
            </span>
          </WhenDestinationPhoto>
        </ImageAssetBoundary>
      </div>
      <div className="card-body">
        <div>
          <Heading>{plan.destination.name[locale]}</Heading>
          <p className="small muted">
            {plan.request.dates.startDate} → {plan.request.dates.endDate}
          </p>
          <p className="muted small">
            {plan.destination.country[locale]} · {plan.request.nights}{" "}
            {t.nights}
          </p>
        </div>
        {flying ? (
          <PlanTripCost plan={plan} />
        ) : completePlan(plan) ? (
          <div>
            <div className="total">
              <strong>
                {formatMoney(
                  planDerived(plan.budget.estimatedSpend, plan),
                  locale,
                )}
              </strong>
              <span>{t.estimatedSpend}</span>
            </div>
            <p className="small">
              {t.safetyBuffer}:{" "}
              {formatMoney(planDerived(plan.safetyBuffer, plan), locale)} ·{" "}
              {t.budgetNeeded}:{" "}
              {formatMoney(planDerived(plan.budget.budgetNeeded, plan), locale)}
            </p>
            <BudgetBar plan={plan} />
            <p className="small">
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
                )}{" "}
                {plan.budget.fit === "over" ? t.over : t.left}
              </b>{" "}
              · {formatMoney(planDerived(plan.safetyBuffer, plan), locale)}{" "}
              {t.buffer}
            </p>
            <span className={`fit ${plan.budget.fit}`}>
              {t[plan.budget.fit]}
            </span>
          </div>
        ) : (
          <UnpricedSummary plan={plan} locale={locale} t={t} />
        )}
        <div>
          <p className="eyebrow ember-text">{t.why}</p>
          <p>
            {flying
              ? "Compare the fare and room evidence, then check prices for your dates."
              : completePlan(plan)
                ? plan.destination.why[locale]
                : t.unpricedIdeaReason}
          </p>
        </div>
        {explanation ? (
          <div className="ai-explanation">
            <p className="eyebrow ember-text">{aiCopy[locale].why}</p>
            <p>{explanation}</p>
          </div>
        ) : null}
        <AirportSummary plan={plan} locale={locale} t={t} />
        <TripProvenance plan={plan} t={t} locale={locale} />
        <FlightAffiliateCTA
          plan={plan}
          placement="results"
          locale={locale}
          t={t}
        />
        {!flying && (
          <details>
            <summary>
              {t.breakdown}
              <span>+</span>
            </summary>
            <CostRows plan={plan} locale={locale} t={t} />
          </details>
        )}
        <Link
          className="button"
          href={localePath(
            locale,
            `/plan/trips/${plan.id}?${requestQuery(plan.request)}`,
          )}
        >
          {t.open} →
        </Link>
      </div>
    </article>
  );
}
