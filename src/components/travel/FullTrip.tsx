"use client";
import { localePath } from "@/i18n/routing";
import {
  requestBudget,
  planDerived,
  quoteMoney,
} from "../../domain/money/provenance";
import {
  StayPrice,
  StayEvidenceDetails,
  stayAmountLabel,
} from "./StayEvidence";
import { GatewaySummary } from "./GatewaySummary";
import { completePlan, matchingFlight } from "@/domain/flight-pricing";
import { AirportSummary } from "./AirportSummary";
import { withAirportComparison } from "@/domain/airport-comparison";
import { SearchSummary } from "./SearchSummary";
import { FlightAffiliateCTA } from "./FlightAffiliateCTA";

import { locationName } from "@/catalogue/locations";
import { useRouter } from "next/navigation";
import { SourceIssues } from "./SourceIssues";
import { useState } from "react";
import Link from "next/link";
import type { DemoScenario, TripTemplate, TripRequest } from "@/domain/types";
import { requestQuery } from "@/domain/request";
import { pricePlan } from "@/domain/pricing";
import { formatMoney, type Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries";
import { FareFreshness } from "./FareFreshness";
import { NearbyFares } from "./NearbyFares";
import type { NearbyFare } from "../../domain/nearby-fares";
import { BudgetBar, CostProvenance, CostRows, PriceLegend } from "./Budget";
import { ResultPrice } from "./ResultPrice";
import { TripOverview } from "./TripOverview";
import { tripDetailCopy } from "@/i18n/trip-detail";
import { resultsCopy } from "@/i18n/results";
import type { TripContentSections } from "./TripContent";
export function FullTrip({
  base,
  comparisons = [],
  initial,
  scenario: initialScenario,
  allowDemoScenarios = false,
  today,
  locale,
  t,
  contentSections,
  guideHref,
  nearbyFares = [],
  tripPath,
}: {
  base: TripTemplate;
  comparisons?: TripTemplate[];
  initial: TripRequest;
  scenario: DemoScenario;
  allowDemoScenarios?: boolean;
  today: string;
  locale: Locale;
  t: Dictionary;
  contentSections?: TripContentSections;
  guideHref?: string;
  nearbyFares?: NearbyFare[];
  tripPath?: string;
}) {
  const router = useRouter();
  const [request, setRequest] = useState(initial);
  const [scenario, setScenario] = useState(initialScenario);
  const [snapshot, setSnapshot] = useState(
    () => pricePlan(base, initial).budget?.estimatedSpend,
  );
  const [accepted, setAccepted] = useState(false);
  const [copied, setCopied] = useState("");
  const plan = withAirportComparison(
    pricePlan(base, request, scenario, snapshot),
    comparisons.map((b) => pricePlan(b, request)),
  );
  const flying = plan.transportMode === "flight";
  const transportCost = plan.costs.find((c) => c.category === "transport");
  const copyText = tripDetailCopy[locale];
  function sync(r: TripRequest, s: DemoScenario) {
    window.history.replaceState(
      window.history.state,
      "",
      `?${requestQuery({ ...r, departureAirport: base.transport.departure?.code })}${allowDemoScenarios ? `&scenario=${s}` : ""}`,
    );
  }
  function changeScenario(s: DemoScenario) {
    setScenario(s);
    setAccepted(false);
    setSnapshot(pricePlan(base, request).budget?.estimatedSpend);
    sync(request, s);
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(t.copied);
    } catch {
      setCopied(t.copyError);
    }
  }
  return (
    <main id="main" className="trip-detail-page">
      <div className="shell trip-detail-shell">
        <div className="trip-detail-toolbar">
          <Link
            className="trip-back"
            href={localePath(locale, `/plan/results?${requestQuery(request)}`)}
          >
            ← {t.allTrips}
          </Link>
          <SearchSummary
            request={request}
            locale={locale}
            t={t}
            today={today}
          />
        </div>
        {allowDemoScenarios &&
        base.transport.mode === "road" &&
        base.transport.price.demo ? (
          <details className="scenario-controls">
            <summary>{t.demoStates} +</summary>
            <div className="chips">
              {(["none", "price-change", "unavailable"] as const).map((s) => (
                <button
                  key={s}
                  aria-pressed={scenario === s}
                  className={`pill ${scenario === s ? "active" : ""}`}
                  onClick={() => changeScenario(s)}
                >
                  {s === "none"
                    ? t.normal
                    : s === "price-change"
                      ? t.priceChange
                      : t.unavailable}
                </button>
              ))}
            </div>
          </details>
        ) : null}
        <TripOverview
          plan={plan}
          locale={locale}
          t={t}
          today={today}
          intro={contentSections?.overview}
        >
          <section
            className="trip-budget stack"
            id="trip-budget"
            aria-labelledby="trip-budget-title"
            aria-live="polite"
          >
            <div className="row-between">
              <h2 id="trip-budget-title">
                {copyText.budget} ·{" "}
                {formatMoney(requestBudget(request), locale)}
              </h2>
              {!flying && completePlan(plan) ? (
                <span className={`fit ${plan.budget.fit}`}>
                  {t[plan.budget.fit]}
                </span>
              ) : null}
            </div>
            {!flying &&
            completePlan(plan) &&
            snapshot &&
            scenario === "price-change" &&
            !accepted ? (
              <div
                className={`notice ${plan.budget.fit === "over" ? "warning" : "good"} stack`}
              >
                <b>{t.priceChanged}</b>
                <dl className="cost-rows">
                  <div>
                    <dt>{t.snapshot}</dt>
                    <dd>{formatMoney(planDerived(snapshot, plan), locale)}</dd>
                  </div>
                  <div>
                    <dt>{t.current}</dt>
                    <dd>
                      {formatMoney(
                        planDerived(plan.budget.estimatedSpend, plan),
                        locale,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{t.delta}</dt>
                    <dd>
                      {plan.budget.priceChangeSpendDelta.cents > 0 ? "+" : ""}
                      {formatMoney(
                        planDerived(plan.budget.priceChangeSpendDelta, plan),
                        locale,
                      )}
                    </dd>
                  </div>
                </dl>
                <p>
                  {plan.budget.fit === "over"
                    ? `${formatMoney(planDerived(plan.budget.overBudget, plan, true), locale)} ${t.over}`
                    : t.stillFits.replace(
                        "{budget}",
                        formatMoney(requestBudget(request), locale),
                      )}
                </p>
                {plan.budget.fit === "over" ? (
                  <>
                    {request.preferences.stayLevel !== "simple" ? (
                      <button
                        className="button"
                        onClick={() => {
                          const r = {
                            ...request,
                            preferences: {
                              ...request.preferences,
                              stayLevel: "simple" as const,
                            },
                          };
                          setRequest(r);
                          sync(r, scenario);
                        }}
                      >
                        {t.simpleAlt}
                      </button>
                    ) : (
                      <Link
                        className="button"
                        href={localePath(
                          locale,
                          `/plan/results?${requestQuery(request)}`,
                        )}
                      >
                        {t.allTrips} →
                      </Link>
                    )}
                    <Link
                      href={localePath(
                        locale,
                        `/plan?${requestQuery(request)}`,
                      )}
                    >
                      {t.edit}
                    </Link>
                  </>
                ) : (
                  <button
                    className="button"
                    onClick={() => {
                      setSnapshot(plan.budget.estimatedSpend);
                      setAccepted(true);
                    }}
                  >
                    {t.accept}
                  </button>
                )}
              </div>
            ) : null}
            {accepted ? <p className="notice good">✓ {t.accepted}</p> : null}
            <div className="trip-budget-main">
              <div className="trip-budget-summary stack">
                <ResultPrice plan={plan} locale={locale} t={t} />
                {transportCost ? (
                  <FareFreshness
                    money={quoteMoney(transportCost)}
                    locale={locale}
                  />
                ) : null}
                {!flying && completePlan(plan) ? (
                  <p className="small muted">
                    {resultsCopy[locale].reserveExplanation}
                  </p>
                ) : null}
              </div>
              <div className="trip-transport stack">
                {flying ? (
                  <section
                    id="flight-handoff"
                    className="flight-booking stack"
                    aria-label={t.flightBooking}
                  >
                    <div>
                      <h3>{t.flightLabel}</h3>
                      <p className="trip-flight-route small">
                        {matchingFlight(plan)?.originAirport ??
                          plan.departure?.code ??
                          matchingFlight(plan)?.originCode ??
                          request.origin?.name ??
                          locationName(request.originId)}
                        {" → "}
                        {plan.arrival?.label[locale] ??
                          matchingFlight(plan)?.destinationAirport ??
                          matchingFlight(plan)?.destinationCode ??
                          plan.directArrival?.flightDestinationCode ??
                          plan.destination.iataCodes?.[0] ??
                          plan.destination.name[locale]}
                      </p>
                    </div>
                    <GatewaySummary plan={plan} locale={locale} />
                    {matchingFlight(plan) ? (
                      <p className="mono small">
                        {formatMoney(quoteMoney(plan.costs[0]), locale)} ·{" "}
                        {t.recentFare}
                      </p>
                    ) : null}
                    <FlightAffiliateCTA
                      plan={plan}
                      placement="trip"
                      locale={locale}
                      t={t}
                    />
                    <p className="small muted">{copyText.providerNote}</p>
                    {plan.departure?.transfer ? (
                      <AirportSummary plan={plan} locale={locale} t={t} />
                    ) : null}
                    {tripPath ? (
                      <NearbyFares
                        fares={nearbyFares}
                        request={request}
                        tripPath={tripPath}
                        locale={locale}
                      />
                    ) : null}
                  </section>
                ) : (
                  <div className="stack trip-road-summary">
                    <h3>{t.gettingThere}</h3>
                    <p>
                      {request.origin?.name ?? locationName(request.originId)} →{" "}
                      {plan.destination.name[locale]}
                    </p>
                    <p className="small muted">{t.roadDesc}</p>
                  </div>
                )}
              </div>
            </div>
            <details
              className="trip-budget-details trip-disclosure"
              id="price-details"
            >
              <summary>
                <h2>{copyText.breakdown}</h2>
              </summary>
              <div className="stack">
                {!flying && <CostRows plan={plan} locale={locale} t={t} />}
                {!flying && completePlan(plan) ? (
                  <BudgetBar plan={plan} />
                ) : null}
                {flying ? (
                  <>
                    <p className="small muted">{t.flightPartyNote}</p>
                    {request.preferences.luggage ? (
                      <p className="small muted">{t.bagEstimate}</p>
                    ) : null}
                    {plan.requestedDates ? (
                      <p className="small muted">
                        {plan.requestedDates.mode === "weekends"
                          ? t.weekendFareDates
                          : t.flexibleFareDates}
                      </p>
                    ) : null}
                    <AirportSummary plan={plan} locale={locale} t={t} detail />
                  </>
                ) : null}
                {plan.costs.some((c) => c.source.status !== "available") ? (
                  <div className="stack trip-source-issues">
                    <SourceIssues
                      issues={plan.costs
                        .filter((c) => c.source.status !== "available")
                        .map((c) => ({
                          destinationId: plan.id,
                          category:
                            c.category === "stay" ? "stay" : "transport",
                          source: c.source,
                        }))}
                      t={t}
                    />
                    <button
                      className="text-button"
                      onClick={() => {
                        changeScenario("none");
                        router.refresh();
                      }}
                    >
                      {t.retry}
                    </button>
                  </div>
                ) : null}
              </div>
            </details>
          </section>
        </TripOverview>
        {contentSections ? (
          <nav className="trip-section-nav" aria-label={copyText.onThisPage}>
            {contentSections.days ? (
              <a href="#days">{copyText.dayPlan}</a>
            ) : null}
            {contentSections.attractions ? (
              <a href="#worth-seeing">{copyText.places}</a>
            ) : null}
            <a href="#where-to-stay">{t.whereStay}</a>
            {contentSections.transport ? (
              <a href="#getting-around">{copyText.transport}</a>
            ) : null}
            {contentSections.practical ? (
              <a href="#before-you-go">{copyText.beforeYouGo}</a>
            ) : null}
            <a href="#trip-sources">{copyText.sources}</a>
          </nav>
        ) : null}
        <div className="trip-detail-content">
          {contentSections?.days ??
            (base.itinerary.length ? (
              <section
                className="trip-content-section"
                id="days"
                aria-labelledby="trip-outline-title"
              >
                <h2 id="trip-outline-title">{copyText.outline}</h2>
                <p className="small muted">{copyText.genericOutline}</p>
                <ol className="trip-content-stop-list">
                  {copyText.genericStops.map((stop) => (
                    <li key={stop}>{stop}</li>
                  ))}
                </ol>
              </section>
            ) : null)}
          {contentSections?.attractions}
          <section
            className="trip-content-section"
            id="where-to-stay"
            aria-labelledby="trip-stay-title"
          >
            <h2 id="trip-stay-title">{t.whereStay}</h2>
            {flying ? (
              <p>
                See the labelled room evidence and date-specific Booking.com
                search in the trip costs above.
              </p>
            ) : (
              <div className="trip-stay-estimate">
                <div className="stack">
                  <StayPrice plan={plan} locale={locale} />
                  <details className="trip-room-details">
                    <summary>How rooms are counted</summary>
                    <StayEvidenceDetails
                      plan={plan}
                      locale={locale}
                      allocation
                    />
                  </details>
                </div>
                <div
                  className="stay-levels"
                  role="group"
                  aria-label={t.whereStay}
                >
                  {(["simple", "standard", "comfort"] as const).map((level) => {
                    const changed = {
                      ...request,
                      preferences: { ...request.preferences, stayLevel: level },
                    };
                    const next = pricePlan(base, changed, scenario);
                    return (
                      <button
                        className={`stay-level ${request.preferences.stayLevel === level ? "selected" : ""}`}
                        aria-pressed={request.preferences.stayLevel === level}
                        key={level}
                        onClick={() => {
                          setRequest(changed);
                          sync(changed, scenario);
                        }}
                      >
                        <b>{t[level]}</b>
                        <span className="mono small">
                          {stayAmountLabel(next, locale)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {contentSections?.areas}
          </section>
          {contentSections?.transport}
          {contentSections?.practical ? (
            <section
              className="trip-content-section"
              id="before-you-go"
              aria-labelledby="trip-before-title"
            >
              <h2 id="trip-before-title">{copyText.beforeYouGo}</h2>
              {contentSections.practical}
            </section>
          ) : null}
          <details className="trip-sources trip-disclosure" id="trip-sources">
            <summary>
              <h2>{copyText.sources}</h2>
            </summary>
            <div className="stack">
              <div className="trip-pricing-sources stack">
                <h3>{copyText.pricingSources}</h3>
                {!flying && <CostProvenance plan={plan} locale={locale} />}
                <PriceLegend hybrid={flying} t={t} />
                <p className="small muted">{t.priceNote}</p>
              </div>
              {contentSections?.sources}
            </div>
          </details>
          <div className="trip-guide-band">
            <div>
              <p className="eyebrow">{plan.destination.name[locale]}</p>
              <h2>
                {guideHref
                  ? `More on ${plan.destination.name[locale]}`
                  : "Keep your trip handy"}
              </h2>
              {guideHref ? (
                <p>
                  Places, neighbourhoods and practical information in the
                  reviewed destination guide.
                </p>
              ) : null}
            </div>
            <div className="trip-share">
              {guideHref ? (
                <Link className="button" href={guideHref}>
                  Read the {plan.destination.name[locale]} guide →
                </Link>
              ) : null}
              <button className="button outline" onClick={copy}>
                {t.copy} ↗
              </button>
              {copied ? (
                <p role="status" className="small">
                  {copied}
                </p>
              ) : null}
              <Link
                href={localePath(
                  locale,
                  `/plan/results?${requestQuery(request)}`,
                )}
              >
                ← {t.allTrips}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
