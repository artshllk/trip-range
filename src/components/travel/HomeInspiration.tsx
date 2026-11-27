import { localePath } from "@/i18n/routing";
import { planDerived } from "../../domain/money/provenance";
import Link from "next/link";
import type { TripRequest, TripTemplate } from "@/domain/types";
import { pricePlan } from "@/domain/pricing";
import { completePlan } from "@/domain/flight-pricing";
import { requestQuery } from "@/domain/request";
import { formatMoney, type Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries";
import { homeCopy } from "@/i18n/home";
import {
  DestinationImage,
  ImageAssetBoundary,
  WhenDestinationPhoto,
} from "./DestinationImage";
import { ImageAttribution } from "./Provenance";

/** Editorial selection from the existing catalogue; pricing still comes from the trip engine. */
export function HomeInspiration({
  bases,
  request,
  locale,
  t,
}: {
  bases: TripTemplate[];
  request: TripRequest;
  locale: Locale;
  t: Dictionary;
}) {
  const c = homeCopy[locale];
  const plans = bases.slice(0, 3).map((base) => pricePlan(base, request));
  return (
    <section
      id="explore"
      className="shell home-inspiration"
      aria-labelledby="inspiration-title"
    >
      <div className="section-heading">
        <div>
          <h2 id="inspiration-title">{c.inspiration}</h2>
          <p className="muted">{c.inspirationNote}</p>
        </div>
      </div>
      <div className="inspiration-grid">
        {plans.map((plan) => {
          const href = localePath(
            locale,
            `/plan/trips/${plan.id}?${requestQuery(plan.request)}`,
          );
          return (
            <article className="inspiration-card" key={plan.id}>
              <ImageAssetBoundary
                destination={plan.destination}
                locale={locale}
                image={plan.destination.image}
                fallback={plan.destination.fallbackImage}
              >
                <Link
                  href={href}
                  className="inspiration-photo"
                  aria-label={`${c.trip}: ${plan.destination.name[locale]}`}
                >
                  <DestinationImage
                    fallbackAlt={t.photo}
                    fill
                    loading="lazy"
                    sizes="(min-width: 1240px) 380px, (min-width: 720px) 30vw, 90vw"
                  />
                  <span className="inspiration-photo-shade" />
                  <h3>{plan.destination.name[locale]}</h3>
                  <span className="inspiration-arrow" aria-hidden="true">
                    ↗
                  </span>
                </Link>
                <div className="inspiration-copy">
                  <p>
                    {plan.destination.country[locale]} · {plan.request.nights}{" "}
                    {t.nights} ·{" "}
                    {plan.request.party.adults + plan.request.party.children}{" "}
                    {t.people}
                  </p>
                  {completePlan(plan) ? (
                    <p className="inspiration-price">
                      {c.estimate}{" "}
                      <strong>
                        ≈{" "}
                        {formatMoney(
                          planDerived(plan.budget.estimatedSpend, plan),
                          locale,
                        )}
                      </strong>
                    </p>
                  ) : (
                    <>
                      <p className="inspiration-price">{c.flightNeeded}</p>
                      <p className="small muted">
                        {c.otherCosts} ≈{" "}
                        {formatMoney(
                          planDerived(plan.knownNonFlightCosts, plan),
                          locale,
                        )}
                      </p>
                    </>
                  )}
                  <WhenDestinationPhoto>
                    <div className="inspiration-credit">
                      <ImageAttribution t={t} />
                    </div>
                  </WhenDestinationPhoto>
                </div>
              </ImageAssetBoundary>
            </article>
          );
        })}
      </div>
    </section>
  );
}
