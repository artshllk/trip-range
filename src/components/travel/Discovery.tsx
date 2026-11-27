"use client";
import { localePath } from "@/i18n/routing";
import { planDerived } from "../../domain/money/provenance";
import { completePlan } from "@/domain/flight-pricing";
import { ImageAttribution } from "./Provenance";
import { locationName } from "@/catalogue/locations";
import { useState } from "react";
import {
  DestinationImage,
  ImageAssetBoundary,
  WhenDestinationPhoto,
} from "./DestinationImage";
import Link from "next/link";
import type { TripTemplate } from "@/domain/types";
import type { Dictionary } from "@/i18n/dictionaries";
import { formatMoney, type Locale } from "@/i18n/config";
import { requestQuery } from "@/domain/request";
import { pricePlan } from "@/domain/pricing";
import { primaryOriginId } from "@/domain/market/primary-origin";
export function Discovery({
  initial: defaultRequest,
  bases,
  swissBases,
  locale,
  t,
}: {
  initial: import("@/domain/types").TripRequest;
  bases: TripTemplate[];
  swissBases: TripTemplate[];
  locale: Locale;
  t: Dictionary;
}) {
  const [tab, setTab] = useState("under300");
  const tabs = [
    "under300",
    "weekends",
    "noFlight",
    "hidden",
    "families",
    "swiss",
  ] as const;
  const request = {
    ...defaultRequest,
    budget: {
      ...defaultRequest.budget,
      cents:
        tab === "under300" || tab === "hidden"
          ? 30000
          : tab === "families"
            ? 150000
            : tab === "swiss"
              ? 200000
              : 60000,
    },
    originId: tab === "swiss" ? "zurich" : primaryOriginId,
    party: { adults: 2, children: tab === "families" ? 2 : 0 },
  };
  const plans = (tab === "swiss" ? swissBases : bases)
    .map((b) => pricePlan(b, request))
    .filter(completePlan)
    .filter(
      (p) =>
        p.budget.fit !== "over" &&
        (tab !== "hidden" || p.destination.countryCode === "XK") &&
        (tab !== "noFlight" || p.transportMode === "road"),
    )
    .slice(0, 5);
  return (
    <section id="explore" className="section discovery">
      <div className="shell">
        <div className="section-heading">
          <div>
            <p className="eyebrow ember-text">{t.discovery}</p>
            <h2>
              {tab === "under300"
                ? t.discoverTitle
                : t[tab as (typeof tabs)[number]]}
            </h2>
            <p className="muted">
              {t.discoverSub.replace("Tirana", locationName(request.originId))}
            </p>
          </div>
          <Link href={localePath(locale, `/plan?${requestQuery(request)}`)}>
            {t.all} →
          </Link>
        </div>
        <div className="chips scroll-chips">
          {tabs.map((id) => (
            <button
              aria-pressed={tab === id}
              className={`pill ${tab === id ? "active" : ""}`}
              key={id}
              onClick={() => setTab(id)}
            >
              {t[id]}
            </button>
          ))}
        </div>
        <div className="mosaic">
          {plans.map((p) => (
            <article key={p.id} className="discovery-card">
              <ImageAssetBoundary
                destination={p.destination}
                locale={locale}
                image={p.destination.image}
                fallback={p.destination.fallbackImage}
              >
                <Link
                  className="discovery-image-link"
                  aria-label={p.destination.name[locale]}
                  href={localePath(
                    locale,
                    `/plan/trips/${p.id}?${requestQuery(request)}`,
                  )}
                >
                  <DestinationImage
                    fallbackAlt={t.photo}
                    fill
                    sizes="(min-width: 720px) 40vw, 80vw"
                  />
                  <span className="photo-tag">
                    {p.transportMode === "flight"
                      ? t.transport
                      : p.destination.countryCode === "XK"
                        ? t.hidden
                        : t.noFlight}
                  </span>
                </Link>
                <span className="discovery-copy">
                  <h3>
                    <Link
                      href={localePath(
                        locale,
                        `/plan/trips/${p.id}?${requestQuery(request)}`,
                      )}
                    >
                      {p.destination.name[locale]}
                    </Link>
                  </h3>
                  <p>
                    {p.destination.country[locale]} · 2 {t.nights}
                  </p>
                  <div>
                    <b className="price-pill">
                      {formatMoney(
                        planDerived(p.budget.estimatedSpend, p),
                        locale,
                      )}{" "}
                      {t.estimatedSpend} ·{" "}
                      {request.party.adults + request.party.children} {t.people}
                    </b>
                    <small>
                      {t.safetyBuffer}:{" "}
                      {formatMoney(planDerived(p.safetyBuffer, p), locale)}
                    </small>
                    <small>
                      ●{" "}
                      {formatMoney(
                        planDerived(p.budget.remainingAfterReserve, p, true),
                        locale,
                      )}{" "}
                      {t.left}
                    </small>
                  </div>
                  <WhenDestinationPhoto>
                    <small className="photo-note">
                      <ImageAttribution t={t} />
                    </small>
                  </WhenDestinationPhoto>
                </span>
              </ImageAssetBoundary>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
