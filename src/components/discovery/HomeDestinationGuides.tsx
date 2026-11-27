import type { DestinationCard } from "@/domain/destination-discovery";
import { ContextLink } from "./ContextLink";
import type { TravelLocation } from "@/domain/types";
import {
  DestinationImage,
  ImageAssetBoundary,
} from "../travel/DestinationImage";
import { DestinationPhotoCredit } from "../travel/Provenance";
import { DestinationCards } from "./DestinationCards";
import en from "@/i18n/en.json";

export function HomeDestinationGuides({
  cards,
  targets,
}: {
  cards: DestinationCard[];
  targets: Record<string, TravelLocation | undefined>;
}) {
  return (
    <section
      id="explore"
      className="shell home-guides"
      aria-labelledby="destinations-title"
    >
      <div className="home-section-heading">
        <div>
          <h2 id="destinations-title">City guides</h2>
          <p>
            Where to stay, what to see first and how to get around. From
            reviewed sources.
          </p>
        </div>
        <ContextLink
          prefetch={false}
          className="discovery-text-link"
          path="/destinations"
        >
          All destination guides <span aria-hidden="true">↗</span>
        </ContextLink>
      </div>
      <div className="home-guide-grid">
        {cards.slice(0, 4).map((card, index) => (
          <article
            className={`home-guide${index === 0 ? " home-guide-featured" : ""}`}
            key={card.subject}
          >
            <ImageAssetBoundary
              destination={{
                id: card.subject,
                name: { en: card.name, sq: card.name },
              }}
              locale="en"
              image={card.image}
            >
              <ContextLink
                prefetch={false}
                className={`home-guide-photo${card.image ? "" : " home-guide-no-photo"}`}
                path={`/destinations/${card.slug}`}
                aria-label={`Explore ${card.name}`}
              >
                {card.image ? (
                  <DestinationImage
                    fallbackAlt={card.name}
                    fill
                    loading="lazy"
                    fetchPriority="low"
                    sizes={
                      index === 0
                        ? "(max-width: 899px) calc(100vw - 32px), (max-width: 1279px) 48vw, 616px"
                        : "(max-width: 599px) 84px, 180px"
                    }
                  />
                ) : (
                  <>
                    <span aria-hidden="true">{card.countryCode}</span>
                    <span>{card.name}</span>
                  </>
                )}
              </ContextLink>
              <div className="home-guide-copy">
                <p className="home-guide-country">{card.country}</p>
                <h3>
                  <ContextLink
                    prefetch={false}
                    path={`/destinations/${card.slug}`}
                  >
                    {card.name}
                  </ContextLink>
                </h3>
                <p className="home-guide-description">{card.description}</p>
                <div className="home-guide-links">
                  <ContextLink
                    prefetch={false}
                    path={`/destinations/${card.slug}`}
                    aria-label={`Read ${card.name} guide`}
                  >
                    Read guide
                  </ContextLink>
                  {targets[card.subject] ? (
                    <ContextLink
                      prefetch={false}
                      path="/"
                      toPlace={targets[card.subject]}
                    >
                      Trips to {card.name} <span aria-hidden="true">→</span>
                    </ContextLink>
                  ) : null}
                </div>
                <DestinationPhotoCredit t={en} summary="Photo credit" />
              </div>
            </ImageAssetBoundary>
          </article>
        ))}
      </div>
      {cards.length > 4 ? (
        <details className="home-more-guides">
          <summary>
            More city guides{" "}
            <span>{cards.length - 4} more places to explore</span>
          </summary>
          <DestinationCards cards={cards.slice(4)} />
        </details>
      ) : null}
    </section>
  );
}
