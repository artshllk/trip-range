import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { pageMetadata } from "@/services/seo";
import { ContextLink } from "@/components/discovery/ContextLink";
/** Static copy; search context is carried client-side on click. */
export const dynamic = "force-static";
type Props = { params: Promise<{ locale: string }> };
export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return pageMetadata(
    locale,
    { absolute: "About Trip Range" },
    "Budget-first travel discovery: understand the whole trip, explore reviewed destinations and check the booking details with the provider.",
    { en: "/about" },
  );
}
export default async function Page({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <main id="main" className="shell about-product">
      <p className="eyebrow">About Trip Range</p>
      <h1>The trip is more than the flight.</h1>
      <p className="about-lede">
        Trip Range starts with your budget for everyone travelling, for the
        whole trip. The aim is to make the trade-offs visible before you decide
        where to go.
      </p>
      <section>
        <h2>Plan the whole picture</h2>
        <p>
          Compare available flight evidence with planning estimates for stays,
          food, local transport and activities. A separate safety reserve is
          room in your budget, not money you are expected to spend.
        </p>
      </section>
      <section>
        <h2>Know what is still unknown</h2>
        <p>
          A reference fare for other dates is not the price of your selected
          trip. Missing required costs keep a total incomplete; Trip Range does
          not treat them as zero or claim the trip fits your budget.
        </p>
      </section>
      <section>
        <h2>Explore, then verify</h2>
        <p>
          Our destination guides use reviewed sources. Where a flight booking
          link is available, it opens an external provider search. Check the
          actual airports, dates, travellers, fare and availability there before
          booking. Trip Range does not sell or confirm the booking.
        </p>
        <p>
          Some outbound links are affiliate links and may earn a commission.
          Optional AI helps interpret a trip description; it does not set the
          prices or replace the budget calculation.
        </p>
      </section>
      <div className="about-actions">
        <ContextLink path="/" hash="search" className="button">
          Find your trip ↗
        </ContextLink>
        <ContextLink
          prefetch={false}
          path="/destinations"
          className="discovery-text-link"
        >
          Explore destination guides
        </ContextLink>
      </div>
    </main>
  );
}
