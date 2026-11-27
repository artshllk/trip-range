import { customPlannerEnabled } from "@/config/features";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { pageMetadata } from "@/services/seo";
import { guidesIndexable } from "@/seo/destinations";
import { getDestinationGuides } from "@/services/destination-guides";
import { DestinationCards } from "@/components/discovery/DestinationCards";
import { ContextLink } from "@/components/discovery/ContextLink";

/** CDN-served; see the guide page for why five minutes. */
export const revalidate = 300;
type Props = { params: Promise<{ locale: string }> };
export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const guides = await getDestinationGuides();
  return pageMetadata(
    locale,
    "Destination guides",
    "Get to know a city before planning your trip. Reviewed places, neighbourhoods, transport guidance and useful official sources.",
    { en: "/destinations" },
    // The index only lists the guides, so it follows their decision.
    guidesIndexable && guides.length > 0,
  );
}
export default async function Page({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const guides = await getDestinationGuides();
  return (
    <main id="main" className="shell destination-collection">
      <p className="eyebrow">Explore with a little more context</p>
      <h1>Find a place that speaks to you.</h1>
      <p className="collection-lede">
        A small collection of reviewed city guides. Start with the place, then
        find out what the trip could mean for your budget.
      </p>
      {guides.length ? (
        <DestinationCards cards={guides.map((guide) => guide.card)} />
      ) : (
        <p>
          These guides are being reviewed. You can still plan a trip using the
          search.
        </p>
      )}
      <div className="collection-planning">
        {customPlannerEnabled ? (
          <>
            <h2>Already have a trip in mind?</h2>
            <p>
              Choose your own departure airport or city. Destinations shown here
              are ideas, not a statement of flight availability or
              affordability.
            </p>
            <ContextLink className="button" path="/" hash="search">
              Explore trips ↗
            </ContextLink>
          </>
        ) : (
          <>
            <h2>Looking for flights?</h2>
            <p>
              See where two of you can fly for a short break from Tirana,
              London, Barcelona or Warsaw. Destinations shown here are ideas,
              not a statement of flight availability or affordability.
            </p>
            <Link className="button" href="/plan">
              See flights ↗
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
