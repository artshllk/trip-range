"use client";
import { matchingFlight } from "../../domain/flight-pricing";
import type { Locale } from "../../i18n/config";
import { useDisplayedImage } from "./DestinationImage";
import type { FlightDiscoveryFare, TripPlan } from "../../domain/types";
import type { Dictionary } from "../../i18n/dictionaries";
import type { ReactNode } from "react";

// This file's photographer requests a visible credit beside the image.
// Presentation policy only: ImageAssetBoundary still controls which image may render.
// https://commons.wikimedia.org/wiki/File:Vista_a%C3%A9rea_del_Palacio_Bellas_Artes.jpg
const visibleCreditAssets = new Set(["wikimedia-commons:139259979"]);

export function DestinationPhotoCredit({
  t,
  summary,
  visibleClassName = "destination-credit",
  children,
}: {
  t: Dictionary;
  summary?: string;
  visibleClassName?: string;
  children?: ReactNode;
}) {
  const image = useDisplayedImage();
  if (!image) return null;
  if (visibleCreditAssets.has(image.sourceId))
    return (
      <p className={visibleClassName}>
        <ImageAttribution t={t} />
      </p>
    );
  if (children !== undefined) return <>{children}</>;
  return (
    <details className="destination-credit">
      <summary>{summary ?? t.photo}</summary>
      <ImageAttribution t={t} />
    </details>
  );
}

export function ImageAttribution({ t }: { t: Dictionary }) {
  const image = useDisplayedImage();
  if (!image) return null;
  // Optimized local Commons derivatives keep the original source and licence links.
  const localCommons =
    image.source === "local" &&
    /^https:\/\/commons\.wikimedia\.org\/wiki\/File:[^?#\s]+$/.test(
      image.photoUrl ?? "",
    ) &&
    /^https:\/\/creativecommons\.org\/(?:licenses\/by-sa\/(?:3|4)\.0|publicdomain\/zero\/1\.0)\/$/.test(
      image.license ?? "",
    );
  if (localCommons)
    return (
      <span>
        {image.attribution} ·{" "}
        <a href={image.photoUrl} target="_blank" rel="noopener noreferrer">
          Wikimedia Commons
        </a>{" "}
        ·{" "}
        <a href={image.license!} target="_blank" rel="noopener noreferrer">
          {t.imageLicense}
        </a>{" "}
        · {t.imageCropped}
      </span>
    );
  if (image.source !== "provider")
    return (
      <span>
        {image.author ? `${image.author} · ` : ""}
        {image.attribution}
        {image.license ? ` · ${image.license}` : ""}
      </span>
    );
  if (image.sourceId.startsWith("wikimedia-commons:"))
    return (
      <span>
        {image.attribution} ·{" "}
        <a href={image.photoUrl} target="_blank" rel="noreferrer">
          Wikimedia Commons
        </a>{" "}
        ·{" "}
        <a href={image.license ?? undefined} target="_blank" rel="noreferrer">
          {t.imageLicense}
        </a>{" "}
        · {t.imageCropped}
      </span>
    );
  return (
    <span>
      <a href={image.authorUrl} target="_blank" rel="noreferrer">
        {image.author}
      </a>{" "}
      /{" "}
      <a href={image.photoUrl} target="_blank" rel="noreferrer">
        Pexels
      </a>
    </span>
  );
}
export function TripProvenance({
  plan,
  t,
}: {
  plan: TripPlan;
  t: Dictionary;
  locale: Locale;
}) {
  // A single fare from other dates is not evidence about these dates: never shown.
  if (!matchingFlight(plan))
    return plan.transportMode === "flight" ? (
      <p className="small muted">{t.flightPlanningOnly}</p>
    ) : null;
  return (
    <p className="small muted">
      {plan.requestedDates ? (
        <>
          {plan.requestedDates.mode === "weekends"
            ? t.weekendFareDates
            : t.flexibleFareDates}
          : {plan.request.dates.startDate} → {plan.request.dates.endDate}
          <br />
        </>
      ) : null}
      ◷ {plan.costs[0].source.status === "stale"
        ? t.stale
        : t.recentFare} · {t.hybridNote}
      {plan.request.preferences.luggage ? ` ${t.bagEstimate}` : ""}
    </p>
  );
}

/** Route, currency and provider. Observation time lives in FareFreshness, shown once. */
export function FareContext({
  fare,
}: {
  fare: FlightDiscoveryFare;
  locale: Locale;
}) {
  return (
    <span className="fare-evidence-context">
      {fare.originAirport ?? fare.originCode} →{" "}
      {fare.destinationAirport ?? fare.destinationCode}
      {" · "}
      {fare.price.amount.currency}
      {" · "}
      {fare.price.providerId === "travelpayouts-aviasales-data"
        ? "Aviasales"
        : fare.price.providerId}
    </span>
  );
}
