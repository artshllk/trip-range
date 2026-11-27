import { localePath } from "@/i18n/routing";
import "@/components/travel/trip-detail.css";
import { destinationCollection } from "@/domain/destination-discovery";
import { getDestinationGuide } from "@/services/destination-guides";
import { serverEnvironment } from "@/providers/server/environment";
import { notFound, redirect } from "next/navigation";
import { customPlannerEnabled } from "@/config/features";
import { destinationAccess } from "@/travel/runtime/access";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { originResolution, requestQuery, type Query } from "@/domain/request";
import { UnresolvedOrigin } from "@/components/travel/UnresolvedOrigin";
import { getAppTripTemplates as getTripTemplates } from "@/services/app-travel";
import { currentRequest, referenceToday } from "@/services/current-request";
import { FullTrip } from "@/components/travel/FullTrip";
import { approvedDestinationContent } from "@/content/runtime/approved";
import { renderTripContentSections } from "@/components/travel/TripContent";
import {
  selectTripDetailTemplate,
  sharedResultTemplate,
} from "@/services/trip-detail-selection";
import { pricePlan } from "@/domain/pricing";
import { flightHandoff } from "@/domain/affiliate";
import { matchingFlight } from "@/domain/flight-pricing";
import { nearbyFlightFares } from "@/services/nearby-fares";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getDictionary(locale);
  return {
    title: `${t.open} — Trip Range`,
    description: t.priceNote,
    robots: { index: false, follow: true },
  };
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Query>;
}) {
  const { locale, id: rawId } = await params;
  if (!isLocale(locale)) notFound();
  // Custom planner switched off (src/config/features.ts): old links land on /plan.
  if (!customPlannerEnabled) redirect(localePath(locale, "/plan"));
  let id: string;
  try {
    id = decodeURIComponent(rawId);
    if (id.length > 80) notFound();
  } catch {
    notFound();
  }
  const query = await searchParams;
  const r = await currentRequest(query);
  if (!["selected", "catalogue"].includes(originResolution(query)))
    return <UnresolvedOrigin locale={locale} />;
  const providerCity = id.match(/^city:([A-Z]{3})$/)?.[1];
  const direct = providerCity
    ? destinationAccess.directForCode(providerCity)
    : undefined;
  if (direct)
    redirect(
      localePath(
        locale,
        `/plan/trips/${encodeURIComponent(direct.destination.id)}?${requestQuery(r)}`,
      ),
    );
  const access = destinationAccess.get(id);
  // A card's fare must be the page's fare: reuse the results search first.
  const [t, results] = await Promise.all([
    getDictionary(locale),
    getTripTemplates(r),
  ]);
  const shared = sharedResultTemplate(results.templates, r, id, access);
  const search = shared ? results : await getTripTemplates(r, id);
  const base =
    shared ?? selectTripDetailTemplate(search.templates, r, id, access);
  if (!base) {
    if (
      r.departureAirport ||
      search.issues.some(
        (issue) =>
          issue.destinationId === id ||
          issue.destinationId === "flight-discovery",
      )
    )
      return (
        <main id="main" className="shell section">
          <h1>{t.unavailableTitle}</h1>
          <p>{t.incompleteSearch}</p>
          <a href={localePath(locale, `/plan/results?${requestQuery(r)}`)}>
            Start a new search
          </a>
        </main>
      );
    notFound();
  }
  const allowDemoScenarios = !serverEnvironment().production;
  const scenario =
    allowDemoScenarios &&
    (query.scenario === "price-change" || query.scenario === "unavailable")
      ? query.scenario
      : "none";
  // Editorial content joins the view here, after discovery and pricing selection.
  // Only rendered sections cross the client boundary, never research/store data.
  const guideEntry = destinationCollection.find(
    (entry) => entry.subject === base.destination.id,
  );
  const [contentResult, guide] = await Promise.all([
    approvedDestinationContent.get(base.destination.id),
    guideEntry ? getDestinationGuide(guideEntry.slug) : undefined,
  ]);
  const displayedPlan = pricePlan(base, r);
  // No-fare state only: fares from nearby airports (fare side; no transfer claims).
  const handoff = flightHandoff(displayedPlan);
  const nearbyFares =
    handoff && !matchingFlight(displayedPlan)
      ? await nearbyFlightFares(handoff, r.budget.currency)
      : [];
  const contentSections = renderTripContentSections({
    compact: true,
    result: contentResult,
    destinationId: base.destination.id,
    nights: displayedPlan.request.nights,
    startDate: displayedPlan.request.dates.startDate,
    locale,
    fallbackItinerary: base.itinerary,
  });
  return (
    <FullTrip
      key={JSON.stringify([id, r, scenario])}
      base={base}
      allowDemoScenarios={allowDemoScenarios}
      comparisons={search.templates}
      today={referenceToday()}
      initial={r}
      scenario={
        base.transport.mode === "road" && base.transport.price.demo
          ? scenario
          : "none"
      }
      locale={locale}
      t={t}
      contentSections={contentSections}
      nearbyFares={nearbyFares}
      tripPath={localePath(locale, `/plan/trips/${encodeURIComponent(id)}`)}
      guideHref={
        guide
          ? localePath(locale, `/destinations/${guide.card.slug}`)
          : undefined
      }
    />
  );
}
