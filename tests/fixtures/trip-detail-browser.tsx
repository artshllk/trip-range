/** Isolated browser QA only. No production route, flag, or record imports this harness. */
import { createRoot } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { FullTrip } from "../../src/components/travel/FullTrip";
import { renderTripContentSections } from "../../src/components/travel/TripContent";
import { createReviewedDestinationContentStore } from "../../src/content/runtime/store";
import { resolveFlightPricing } from "../../src/domain/flight-pricing";
import { pricePlan } from "../../src/domain/pricing";
import { costTrip } from "../cost-profile-fixtures";
import { trustedImageFixture } from "../destination-image-fixtures";
import {
  tripContentFixture,
  tripContentFixtureContext,
  tripContentDestinationId,
  tripContentNow,
} from "./trip-content";
import en from "../../src/i18n/en.json";
import sq from "../../src/i18n/sq.json";

async function main() {
  const params = new URLSearchParams(location.search);
  const scenario = params.get("scenario") ?? "rich";
  const locale = params.get("locale") === "sq" ? "sq" : "en";
  document.documentElement.lang = locale;
  const data = tripContentFixture();
  const record = data.records[0];
  if (scenario === "none") data.records = [];
  if (scenario === "withdrawn") record.reviewStatus = "withdrawn";
  if (scenario === "partial") {
    delete record.areas;
    delete record.transport;
    delete record.practicalNotes;
    delete record.dayTemplates;
    record.attractions = record.attractions?.slice(0, 1);
  }
  const result = await createReviewedDestinationContentStore(
    data,
    tripContentFixtureContext(),
    () =>
      scenario === "expired"
        ? Date.parse("2026-10-16T12:00:00Z")
        : tripContentNow,
  ).get(tripContentDestinationId);
  if (!["none", "withdrawn"].includes(scenario) && result.status !== "reviewed")
    throw Error(`Invalid synthetic browser fixture: ${result.reason}`);
  const { base, request } = costTrip("EUR");
  base.id = tripContentDestinationId;
  base.destination = {
    ...base.destination,
    id: tripContentDestinationId,
    name: {
      en:
        scenario === "long"
          ? "Synthetic City of the Long River and the Northern Mountain Gardens"
          : "Synthetic City",
      sq:
        scenario === "long"
          ? "Qyteti Sintetik i Lumit të Gjatë dhe Kopshteve të Maleve Veriore"
          : "Qyteti Sintetik",
    },
    country: { en: "Synthetic country", sq: "Shteti sintetik" },
    heroImage:
      scenario === "hero" || scenario === "failed-image"
        ? {
            ...trustedImageFixture,
            destinationId: tripContentDestinationId,
            src:
              scenario === "failed-image"
                ? "/destinations/qa-failed.png"
                : trustedImageFixture.src,
          }
        : undefined,
  };
  base.origin = { ...base.origin, airportIata: "PRN" };
  base.itinerary = [
    { en: "Arrival and free time", sq: "Mbërritja dhe kohë e lirë" },
    { en: "Explore at your own pace", sq: "Eksploro me ritmin tënd" },
    { en: "Journey home", sq: "Kthimi në shtëpi" },
  ];
  if (scenario === "unpriced" || scenario === "provider-unavailable") {
    base.transport = {
      mode: "flight",
      flightPricing: {
        kind: "unavailable",
        reason:
          scenario === "provider-unavailable"
            ? "provider-unavailable"
            : "no-matching-fare",
      },
    };
  }
  if (scenario === "reference" && base.transport.mode === "flight") {
    if (base.transport.flightPricing.kind !== "priced") throw Error("fixture");
    const fare = structuredClone(base.transport.flightPricing.fare);
    fare.scope.dates = {
      startDate: "2026-11-12",
      endDate: "2026-11-14",
      flexibleDays: 0,
    };
    base.transport.flightPricing = resolveFlightPricing(fare, request);
  }
  if (scenario === "road") {
    base.transport = {
      mode: "road",
      price: {
        amount: { cents: 6000, currency: "EUR" },
        confidence: "estimate",
        source: { status: "available" },
        providerId: "goeksplo-road-estimate",
        demo: false,
        observedAt: null,
      },
    };
  }
  const plan = pricePlan(base, request);
  const sections = renderTripContentSections({
    compact: true,
    result,
    destinationId: tripContentDestinationId,
    nights: request.nights,
    startDate: plan.request.dates.startDate,
    locale,
    fallbackItinerary: base.itinerary,
  });
  const root = document.getElementById("root")!;
  // Test-only observable arithmetic, calculated before editorial slots are composed.
  root.dataset.pricing = plan.pricingCompleteness;
  root.dataset.content = result.status;
  root.dataset.estimatedSpend = String(plan.budget?.estimatedSpend.cents ?? "");
  root.dataset.nights = String(request.nights);
  createRoot(root).render(
    <AppRouterContext.Provider
      value={{
        bfcacheId: "synthetic-trip-detail-harness",
        back() {},
        forward() {},
        refresh() {},
        push() {},
        replace() {},
        prefetch() {},
      }}
    >
      <FullTrip
        base={base}
        initial={request}
        scenario="none"
        today="2026-10-10"
        locale={locale}
        t={locale === "en" ? en : sq}
        contentSections={sections}
      />
    </AppRouterContext.Provider>,
  );
}
void main();
