"use client";
import { localePath } from "@/i18n/routing";
import {
  requestBudget,
  planDerived,
  quoteMoney,
} from "../../domain/money/provenance";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { GatewaySummary } from "./GatewaySummary";
import { completePlan } from "@/domain/flight-pricing";
import { requestQuery } from "@/domain/request";
import { flightHandoff } from "@/domain/affiliate";
import type { TripPlan } from "@/domain/types";
import { formatMoney, type Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries";
import { aiCopy } from "@/i18n/ai";
import { resultsCopy } from "@/i18n/results";
import { localized } from "@/i18n/localized";
import { flightRoomCopy } from "@/i18n/flight-room";
import { AirportSummary } from "./AirportSummary";
import { CostRows, CostProvenance } from "./Budget";
import {
  DestinationPhotoCredit,
  ImageAttribution,
  TripProvenance,
} from "./Provenance";
import {
  DestinationImage,
  ImageAssetBoundary,
  useDisplayedImage,
} from "./DestinationImage";
import { FlightAffiliateCTA } from "./FlightAffiliateCTA";
import { PanelTaxNotice } from "./AccommodationChargeNotice";
import { ResultPrice } from "./ResultPrice";
import { FareFreshness } from "./FareFreshness";
import { ResultDates } from "./ResultDates";
import { ResultInfo } from "./ResultInfo";
import { incompleteCostsExceedBudget } from "./results-state";

function ResultPhotoCredit({ locale, t }: { locale: Locale; t: Dictionary }) {
  const image = useDisplayedImage();
  if (!image) return null;
  return (
    <DestinationPhotoCredit t={t} visibleClassName="photo-caption">
      <div className="result-photo-credit">
        <ResultInfo label={resultsCopy[locale].photo} closeLabel={t.done}>
          <ImageAttribution t={t} />
        </ResultInfo>
      </div>
    </DestinationPhotoCredit>
  );
}

type ResultCardProps = {
  plan: TripPlan;
  locale: Locale;
  t: Dictionary;
  index: number;
  currentYear: string;
  explanation?: string;
  featured?: boolean;
};

export function ResultCard(props: ResultCardProps) {
  const { plan, locale } = props;
  return (
    <ImageAssetBoundary
      destination={plan.destination}
      locale={locale}
      image={plan.destination.image}
      fallback={plan.destination.fallbackImage}
    >
      <ResultCardContent {...props} />
    </ImageAssetBoundary>
  );
}

function ResultCardContent({
  plan,
  locale,
  t,
  index,
  currentYear,
  explanation,
  featured = false,
}: ResultCardProps) {
  const copy = resultsCopy[locale];
  const tripHref = localePath(
    locale,
    `/plan/trips/${encodeURIComponent(plan.id)}?${requestQuery(plan.request)}`,
  );
  const transportCost = plan.costs.find((c) => c.category === "transport");
  // Unpriced with a partner route: the partner is where the price is, so it leads.
  const handoffLeads = !completePlan(plan) && !!flightHandoff(plan);
  const status =
    plan.transportMode === "flight"
      ? locale === "en"
        ? "Compare this trip"
        : "Krahaso këtë udhëtim"
      : completePlan(plan)
        ? plan.budget.fit === "over"
          ? "Over budget"
          : "Fits your budget"
        : plan.pricingCompleteness === "flight-unpriced"
          ? localized(flightRoomCopy, locale).status
          : "Prices incomplete";
  const statusKind =
    plan.transportMode === "flight"
      ? "incomplete"
      : completePlan(plan)
        ? plan.budget.fit === "over"
          ? "over"
          : "fits"
        : "incomplete";
  const badge = (
    <span className={`result-status result-status-${statusKind}`}>
      {status}
    </span>
  );
  const image = useDisplayedImage();
  const imageSrc = image?.src;
  const card = useRef<HTMLElement>(null);
  const [media, setMedia] = useState({ src: imageSrc, reserved: false });
  // A newly displayed asset starts a new transition. Clear before committing its
  // layout so later removal cannot revive a reservation from a previous failure.
  if (media.src !== imageSrc)
    setMedia({ src: imageSrc, reserved: !imageSrc && media.reserved });
  const reserveMedia = !image && media.reserved;
  // Retain only the CSS media footprint, never measured card/disclosure height.
  // Initial missing images are compact; late failures release on exit or toggle.
  useEffect(() => {
    if (!reserveMedia || !card.current || !window.IntersectionObserver) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting)
        setMedia((previous) => ({ ...previous, reserved: false }));
    });
    observer.observe(card.current);
    return () => observer.disconnect();
  }, [reserveMedia]);
  return (
    <article
      ref={card}
      className={`trip-card result-card${featured ? " result-feature" : ""}${image ? "" : " result-card-no-photo"}${reserveMedia ? " result-card-media-reserved" : ""}`}
      data-pricing={plan.pricingCompleteness}
      onErrorCapture={(event) => {
        if (
          !(event.target instanceof HTMLImageElement) ||
          !event.target.closest(".result-visual")
        )
          return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (rect.bottom > 0 && rect.top < window.innerHeight)
          setMedia({ src: imageSrc, reserved: true });
      }}
    >
      {image ? (
        <div className="result-visual">
          <div className="card-photo">
            <DestinationImage
              fallbackAlt={t.photo}
              fill
              loading={index === 0 ? "eager" : "lazy"}
              fetchPriority={index === 0 ? "high" : undefined}
              sizes={
                featured
                  ? "(min-width: 1200px) 550px, (min-width: 900px) 45vw, (min-width: 600px) 560px, calc(100vw - 32px)"
                  : "(min-width: 1200px) 384px, (min-width: 900px) 45vw, (min-width: 600px) 560px, calc(100vw - 32px)"
              }
            />
          </div>
          {badge}
          <ResultPhotoCredit locale={locale} t={t} />
        </div>
      ) : reserveMedia ? (
        <div className="result-media-reserve" aria-hidden="true" />
      ) : (
        <div className="result-no-photo-band">
          <span>{plan.destination.country[locale]}</span>
          {badge}
        </div>
      )}
      <div className="result-destination">
        <h3>{plan.destination.name[locale]}</h3>
        <p className="result-date-line">
          {plan.destination.country[locale]} ·{" "}
          <ResultDates
            start={plan.request.dates.startDate}
            end={plan.request.dates.endDate}
            locale={locale}
            currentYear={currentYear}
          />
          {" · "}
          {plan.request.nights} {t.nights}
        </p>
        {plan.departure && !plan.departure.selected ? (
          <p className="small result-departure">
            {t.departureAirport}: <b>{plan.departure.code}</b>
            {plan.airportSavingCents ? (
              <>
                {" "}
                ·{" "}
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
              </>
            ) : null}
          </p>
        ) : null}
        <GatewaySummary plan={plan} locale={locale} />
        {explanation ? (
          <div className="ai-explanation">
            <p className="eyebrow ember-text">{aiCopy[locale].why}</p>
            <p>{explanation}</p>
          </div>
        ) : null}
      </div>
      <div className="result-booking">
        <ResultPrice plan={plan} locale={locale} t={t} />
        {plan.transportMode !== "flight" && (
          <PanelTaxNotice plan={plan} locale={locale} />
        )}
        {transportCost && plan.transportMode !== "flight" ? (
          <FareFreshness
            money={quoteMoney(transportCost)}
            locale={locale}
            handoffHref={`${tripHref}#flight-handoff`}
          />
        ) : null}
        {plan.transportMode !== "flight" &&
        plan.pricingCompleteness !== "flight-unpriced" &&
        incompleteCostsExceedBudget(plan) ? (
          <p className="small result-known-over">{copy.knownOver}</p>
        ) : null}
      </div>
      <details
        className="result-details"
        onToggle={(event) => {
          if (event.target === event.currentTarget)
            setMedia((previous) => ({ ...previous, reserved: false }));
        }}
      >
        <summary>
          {copy.details}
          <span aria-hidden="true">+</span>
        </summary>
        <div className="stack">
          {plan.transportMode !== "flight" && (
            <CostRows plan={plan} locale={locale} t={t} />
          )}
          {completePlan(plan) ? (
            <p className="small">
              {t.budget}: {formatMoney(requestBudget(plan.request), locale)}
            </p>
          ) : null}
          {plan.transportMode !== "flight" && (
            <CostProvenance plan={plan} locale={locale} />
          )}
          <TripProvenance plan={plan} locale={locale} t={t} />
          <AirportSummary plan={plan} locale={locale} t={t} />
          {plan.transportMode !== "flight" && !completePlan(plan) ? (
            <p className="small muted">{t.fullTotalUnknown}</p>
          ) : null}
        </div>
      </details>
      {/* Unpriced: the partner is where the price is, so the handoff leads, with its
          leaving context and disclosure on the card, not only on the trip page. */}
      <div
        className={`result-actions${handoffLeads ? " result-actions-handoff" : ""}`}
      >
        {handoffLeads ? null : (
          <Link className="button ember" href={tripHref}>
            {copy.explore} →
          </Link>
        )}
        <FlightAffiliateCTA
          plan={plan}
          placement="results"
          primary={handoffLeads}
          locale={locale}
          t={t}
        />
        {handoffLeads ? (
          <Link className="button outline" href={tripHref}>
            {copy.explore} →
          </Link>
        ) : null}
      </div>
    </article>
  );
}
