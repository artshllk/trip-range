import type { DestinationGuide as Guide } from "@/services/destination-guides";
import { ContextLink } from "./ContextLink";
import { JsonLd } from "../seo/JsonLd";
import { guideBreadcrumbSchema } from "@/seo/destinations";
import { renderTripContentSections } from "../travel/TripContent";
import {
  DestinationImage,
  ImageAssetBoundary,
} from "../travel/DestinationImage";
import { DestinationPhotoCredit } from "../travel/Provenance";
import en from "@/i18n/en.json";
import Link from "next/link";
import { customPlannerEnabled } from "@/config/features";

export function DestinationGuide({ guide }: { guide: Guide }) {
  const { card, heroImage, result, target } = guide;
  const sections = renderTripContentSections({
    result,
    destinationId: card.subject,
    nights: 2,
    guideMenuNoteIds: [
      "note:phase4b:vienna:examples:1",
      "note:phase4b:london:examples:1",
      "note:phase4b:paris:examples:1",
    ],
    locale: "en",
    fallbackItinerary: [],
  });
  // Clean hrefs only; the visitor's own search context is added on click.
  const plan = { path: "/", hash: "search", toPlace: target };
  // While the custom planner is off (src/config/features.ts) a guide cannot plan a
  // trip here; it points to the flight view on a clean path instead.
  const flights = (className: string) => (
    <Link prefetch={false} href="/plan" className={className}>
      See flights <span aria-hidden="true">↗</span>
    </Link>
  );
  return (
    <main id="main" className="destination-guide">
      <JsonLd value={guideBreadcrumbSchema(card)} />
      <div className="shell guide-intro">
        <nav className="guide-breadcrumbs" aria-label="Breadcrumb">
          <ContextLink path="/">Trip Range</ContextLink>
          <span aria-hidden="true">/</span>
          <ContextLink prefetch={false} path="/destinations">
            Destinations
          </ContextLink>
          <span aria-hidden="true">/</span>
          <span>{card.name}</span>
        </nav>
        <div className="guide-title-row">
          <div>
            <p className="eyebrow">{card.country} · A practical city guide</p>
            <h1>{card.name}</h1>
          </div>
          {customPlannerEnabled ? (
            <ContextLink prefetch={false} className="button ember" {...plan}>
              {target ? "Plan a trip here" : "Plan your trip"}{" "}
              <span aria-hidden="true">↗</span>
            </ContextLink>
          ) : (
            flights("button ember")
          )}
        </div>
        {heroImage ? (
          <ImageAssetBoundary
            destination={{
              id: card.subject,
              name: { en: card.name, sq: card.name },
            }}
            locale="en"
            image={heroImage}
          >
            <div className="guide-hero">
              <DestinationImage
                fallbackAlt={card.name}
                fill
                preload
                sizes="(max-width:719px) calc(100vw - 40px), (max-width:1050px) calc(100vw - 56px), (max-width:1279px) calc(100vw - 80px), 1200px"
              />
            </div>
            <DestinationPhotoCredit t={en} summary="Photo credit and licence" />
          </ImageAssetBoundary>
        ) : null}
      </div>
      <div className="shell guide-body">
        <article className="guide-editorial">
          <div className="guide-overview">{sections.overview}</div>
          <nav className="guide-section-nav" aria-label="In this guide">
            {sections.leadNotes || sections.transport ? (
              <a href="#cost-logistics">Cost and logistics</a>
            ) : null}
            {sections.areas ? <a href="#staying">Where to stay</a> : null}
            {sections.attractions ? (
              <a href="#worth-seeing">Worth seeing</a>
            ) : null}
            {sections.days ? <a href="#days">A two-night outline</a> : null}
            <a href="#guide-sources">Sources</a>
          </nav>
          {sections.leadNotes || sections.transport ? (
            <section id="cost-logistics" className="trip-content-section">
              <h2>Cost and logistics</h2>
              {sections.leadNotes}
              {sections.transport}
            </section>
          ) : null}
          {sections.areas ? (
            <section id="staying" className="trip-content-section">
              <h2>Choosing a base</h2>
              <p className="small muted">
                Neighbourhood guidance, not hotel inventory or a room-price
                quote.
              </p>
              {sections.areas}
            </section>
          ) : null}
          {sections.attractions}
          {sections.practical ? (
            <section className="trip-content-section">
              <h2>Before you go</h2>
              {sections.practical}
            </section>
          ) : null}
          {sections.days}
          <footer id="guide-sources" className="trip-content-section">
            <h2>Plan with the source in view</h2>
            <p className="small muted">
              Check the official visitor guidance before setting off. Access,
              services and arrangements can change.
            </p>
            {sections.sources}
          </footer>
        </article>
        {customPlannerEnabled ? (
          <aside className="guide-planning" aria-labelledby="plan-heading">
            <p className="eyebrow">Make it your trip</p>
            <h2 id="plan-heading">Start with what you can spend.</h2>
            <p>
              Your whole-trip budget covers everyone travelling. Add your
              departure, dates and party to compare the costs.
            </p>
            <p>
              Missing flight or required transfer prices keep the total
              incomplete. A destination guide is not a booking offer.
            </p>
            <ContextLink prefetch={false} {...plan} className="button ember">
              {target ? "Plan a trip here" : "Open trip search"}{" "}
              <span aria-hidden="true">↗</span>
            </ContextLink>
            <p className="small muted">
              Your existing origin, dates, budget and travellers stay with you.
            </p>
          </aside>
        ) : (
          <aside className="guide-planning" aria-labelledby="plan-heading">
            <p className="eyebrow">Two nights away</p>
            <h2 id="plan-heading">See where two of you can fly.</h2>
            <p>
              Return flights for two from Tirana, London, Barcelona or Warsaw,
              within a budget you set. Rooms, food and local transport are not
              included.
            </p>
            {flights("button ember")}
          </aside>
        )}
      </div>
      <div className="shell guide-bottom">
        <ContextLink
          prefetch={false}
          path="/destinations"
          className="discovery-text-link"
        >
          ← More destination guides
        </ContextLink>
        {customPlannerEnabled ? (
          <ContextLink prefetch={false} {...plan} className="button ember">
            {target ? "Plan this trip" : "Open trip search"}{" "}
            <span aria-hidden="true">↗</span>
          </ContextLink>
        ) : (
          flights("button ember")
        )}
      </div>
    </main>
  );
}
