import { flightCeilings, isMonthDiscovery } from "@/domain/month-discovery";
import { planOrigin, planOrigins } from "@/domain/plan-origins";
import { customPlannerEnabled } from "@/config/features";
import { HomeDestinationGuides } from "@/components/discovery/HomeDestinationGuides";
import { HeroMedia } from "@/components/travel/HeroMedia";
import { JsonLd } from "@/components/seo/JsonLd";
import { organizationSchema, websiteSchema } from "@/seo/publication";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { pageMetadata, homePaths } from "@/services/seo";
import { referenceToday } from "@/services/current-request";
import { homepageRequest } from "@/domain/destination-discovery";
import { requestQuery, type Query } from "@/domain/request";
import { boundedSearchQuery } from "@/domain/request-limits";
import { getDestinationGuides } from "@/services/destination-guides";
import { HomePlanning } from "@/components/discovery/HomePlanning";
import "./homepage.css";
import { HomeExperience } from "@/components/discovery/HomeExperience";
import { DEFAULT_NIGHTS } from "@/domain/stay-length";
type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Query>;
};
export async function generateMetadata({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getDictionary(locale);
  // Search-prefilled variants keep the clean canonical but are never indexed.
  const hasQuery = Object.keys(await searchParams).length > 0;
  return pageMetadata(
    locale,
    t.homeTitle,
    t.homeDescription,
    homePaths,
    !hasQuery,
  );
}
export default async function Home({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const [t, query, guides] = await Promise.all([
    getDictionary(locale),
    searchParams,
    getDestinationGuides(),
  ]);
  if (!boundedSearchQuery(query)) notFound();
  const today = referenceToday();
  const initial = homepageRequest(query, today);
  // With the custom planner off (src/config/features.ts), planner parameters also
  // get the four-origin hero; the planner view below stays unreachable.
  if (isMonthDiscovery(query) || !customPlannerEnabled) {
    // Flights-only promise (owner decision, 24 November 2026). Rewrite this hero once
    // whole-trip costs exist; see docs/collector/handover.md.
    const { origin } = planOrigin(query.depart);
    const ceiling =
      flightCeilings.find((n) => String(n) === query.ceiling) ??
      flightCeilings[0];
    const euros = new Intl.NumberFormat("en-IE", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 0,
    });
    return (
      <main id="main" className="home">
        <JsonLd value={[websiteSchema, organizationSchema]} />
        <section className="hero discovery-hero">
          <HeroMedia
            poster="/demo/hero.jpg"
            mobilePoster="/demo/hero-portrait.jpg"
          />
          <div className="hero-shade" />
          <div id="search" className="hero-content shell">
            <h1>Where can two of you fly for a short break?</h1>
            <p className="discovery-hero-intro">
              Pick where you’re flying from, how many nights and a budget. We
              show the destinations where return flights for two fit inside it.
            </p>
            <p className="discovery-hero-intro">
              Two or three nights from Tirana, London, Barcelona and Warsaw;
              seven nights from London and Warsaw.
            </p>
            {/* A GET form, not links: the indexable homepage carries no
                crawlable query-string variants of /plan. Nothing is stored on
                the device. */}
            <form action="/plan" className="hero-plan-form">
              <label>
                Flying from
                <select name="depart" defaultValue={origin.slug}>
                  {planOrigins.map((o) => (
                    <option key={o.slug} value={o.slug}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Nights
                {/* Two and three are collected from every origin; seven only
                    from London and Warsaw, so it is chosen on /plan. */}
                <select name="nights" defaultValue={DEFAULT_NIGHTS}>
                  {[2, 3].map((n) => (
                    <option key={n} value={n}>
                      {n} nights
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Budget for two
                <select name="ceiling" defaultValue={ceiling}>
                  {flightCeilings.map((n) => (
                    <option key={n} value={n}>
                      {euros.format(n)}
                    </option>
                  ))}
                </select>
              </label>
              <button className="button ember" type="submit">
                Show destinations
              </button>
            </form>
          </div>
        </section>
        <section id="how-it-works" className="shell section stack">
          <h2>What your budget covers</h2>
          <ul>
            <li>
              <strong>Counted:</strong> return flights for two adults. We take
              one adult’s fare, double it, and add a reserve of €20 or 10%,
              whichever is higher.
            </li>
            <li>
              <strong>Not counted:</strong> rooms, food and local transport.
              They still come out of your budget. Each destination links to room
              prices for your dates.
            </li>
            <li>
              <strong>Where the fares come from:</strong> fares Aviasales has
              seen in the last seven days, each shown with the date it was seen.
              They aren’t live quotes, so check the price and seats before you
              book.
            </li>
          </ul>
        </section>
        <HomeDestinationGuides
          cards={guides.map((g) => g.card)}
          targets={Object.fromEntries(
            guides.map((g) => [g.card.subject, g.target]),
          )}
        />
      </main>
    );
  }
  return (
    <main id="main" className="home">
      <JsonLd value={[websiteSchema, organizationSchema]} />
      <HomeExperience
        key={requestQuery(initial)}
        initial={initial}
        today={today}
        cards={guides.map((guide) => guide.card)}
        targets={Object.fromEntries(
          guides.map((guide) => [guide.card.subject, guide.target]),
        )}
        t={t}
      />
      <HomePlanning request={initial} locale={locale} />
    </main>
  );
}
