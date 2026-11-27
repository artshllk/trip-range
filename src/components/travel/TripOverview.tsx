import type { ReactNode } from "react";
import type { TripPlan } from "@/domain/types";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries";
import { trustedDestinationImage } from "@/domain/destination-images";
import {
  DestinationImage,
  ImageAssetBoundary,
  WhenDestinationPhoto,
} from "./DestinationImage";
import { DestinationPhotoCredit, ImageAttribution } from "./Provenance";
import { ResultDates } from "./ResultDates";
import { tripDetailCopy } from "@/i18n/trip-detail";

export function TripOverview({
  plan,
  locale,
  t,
  today,
  intro,
  children,
}: {
  plan: TripPlan;
  locale: Locale;
  t: Dictionary;
  today: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  const request = plan.request;
  const hasPhoto = trustedDestinationImage(
    plan.destination.heroImage,
    plan.destination.id,
  );
  const copyText = tripDetailCopy[locale];
  return (
    <section
      className={`trip-overview${hasPhoto ? "" : " trip-overview-no-photo"}`}
      aria-labelledby="trip-title"
    >
      <div className="trip-overview-copy">
        <div className="trip-detail-heading">
          <p className="eyebrow ember-text">
            {plan.destination.country[locale]}
          </p>
          <h1 id="trip-title">{plan.destination.name[locale]}</h1>
          <p className="trip-detail-dates">
            <ResultDates
              start={plan.request.dates.startDate}
              end={plan.request.dates.endDate}
              locale={locale}
              currentYear={today.slice(0, 4)}
            />
            {" · "}
            {plan.request.nights}{" "}
            {plan.request.nights === 1 ? t.night : t.nights}
            {" · "}
            {request.party.adults + request.party.children} {t.people}
          </p>
        </div>
        {children}
        {intro}
      </div>
      {hasPhoto ? (
        <div className="trip-detail-media">
          <ImageAssetBoundary
            destination={plan.destination}
            locale={locale}
            image={plan.destination.heroImage}
          >
            <DestinationImage
              fallbackAlt={t.photo}
              fill
              preload
              sizes="(max-width: 359px) calc(100vw - 32px), (max-width: 899px) calc(100vw - 40px), 820px"
            />
            <WhenDestinationPhoto>
              <DestinationPhotoCredit t={t} visibleClassName="photo-caption">
                <details className="trip-photo-credit">
                  <summary
                    aria-label={copyText.photoCredits}
                    title={copyText.photoCredits}
                  >
                    ⓘ
                  </summary>
                  <div className="small">
                    <ImageAttribution t={t} />
                  </div>
                </details>
              </DestinationPhotoCredit>
            </WhenDestinationPhoto>
          </ImageAssetBoundary>
        </div>
      ) : null}
    </section>
  );
}
