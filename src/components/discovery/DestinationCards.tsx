import type { DestinationCard } from "@/domain/destination-discovery";
import { ContextLink } from "./ContextLink";
import {
  DestinationImage,
  ImageAssetBoundary,
} from "../travel/DestinationImage";
import { DestinationPhotoCredit } from "../travel/Provenance";
import en from "@/i18n/en.json";

export function DestinationCards({ cards }: { cards: DestinationCard[] }) {
  return (
    <div className="destination-grid">
      {cards.map((card) => (
        <article className="destination-card" key={card.subject}>
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
              path={`/destinations/${card.slug}`}
              className={`discovery-photo${card.image ? "" : " discovery-no-photo"}`}
              aria-label={`Explore ${card.name}`}
            >
              {card.image ? (
                <DestinationImage
                  fallbackAlt={card.name}
                  fill
                  loading="lazy"
                  sizes="(max-width:719px) calc(100vw - 40px), (max-width:759px) calc(100vw - 56px), (max-width:1050px) calc((100vw - 80px) / 2), (max-width:1199px) calc((100vw - 104px) / 2), (max-width:1279px) calc((100vw - 152px) / 4), 282px"
                />
              ) : (
                <>
                  <span className="destination-country-code" aria-hidden="true">
                    {card.countryCode}
                  </span>
                  <span className="destination-type">A city to explore</span>
                  <h3 className="destination-no-photo-title">
                    {card.name}
                    {"\u00a0"}
                    <span aria-hidden="true">↗</span>
                  </h3>
                </>
              )}
            </ContextLink>
            <div className="destination-card-copy">
              <p className="eyebrow">{card.country}</p>
              {card.image ? (
                <h3>
                  <ContextLink
                    prefetch={false}
                    path={`/destinations/${card.slug}`}
                  >
                    {card.name}
                    {"\u00a0"}
                    <span aria-hidden="true">↗</span>
                  </ContextLink>
                </h3>
              ) : null}
              <p>{card.description}</p>
            </div>
            <DestinationPhotoCredit t={en} summary="Photo credit" />
          </ImageAssetBoundary>
        </article>
      ))}
    </div>
  );
}
