/** Isolated reviewed-store UI verification. Synthetic trip frame, never a product route. */
import { createRoot } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { PlaceIdentity } from "../../src/domain/media/types";
import { FullTrip } from "../../src/components/travel/FullTrip";
import { renderTripContentSections } from "../../src/components/travel/TripContent";
import { pricePlan } from "../../src/domain/pricing";
import { findLocation } from "../../src/catalogue/locations";
import type { DestinationContentResult } from "../../src/domain/destination-content/types";
import { costTrip } from "../cost-profile-fixtures";
import en from "../../src/i18n/en.json";
import sq from "../../src/i18n/sq.json";

async function main() {
  const params = new URLSearchParams(location.search);
  const locale = params.get("locale") === "sq" ? "sq" : "en";
  const destinationId = params.get("destination") ?? "";
  const { identity, result } = (await fetch("/runtime-content.json").then((r) =>
    r.json(),
  )) as { identity: PlaceIdentity; result: DestinationContentResult };
  const now = Date.now();
  if (
    destinationId !== "place:Q34600" ||
    identity.subject !== destinationId ||
    result.status !== "reviewed"
  )
    throw Error("Reviewed Kyoto required");
  const { base, request } = costTrip("EUR");
  const origin = findLocation("zurich")!;
  base.id = destinationId;
  base.origin = origin;
  request.originId = origin.id;
  request.origin = origin;
  base.destination = {
    ...base.destination,
    id: destinationId,
    name: { en: identity.name, sq: identity.name },
    country: {
      en:
        new Intl.DisplayNames(["en"], { type: "region" }).of(
          identity.countryCode,
        ) ?? identity.countryCode,
      sq:
        new Intl.DisplayNames(["sq"], { type: "region" }).of(
          identity.countryCode,
        ) ?? identity.countryCode,
    },
    countryCode: identity.countryCode,
    cityCode: identity.cityCode,
    iataCodes: identity.iataCodes,
    coordinates: identity.coordinates,
    heroImage: undefined,
    image: undefined,
  };
  // No pilot content establishes a price or route. The financial frame is a
  // labelled synthetic unavailable-fare fixture, never a claimed live trip.
  base.transport = {
    mode: "flight",
    flightPricing: { kind: "unavailable", reason: "no-matching-fare" },
  };
  base.itinerary = [];
  const plan = pricePlan(base, request);
  const sections = renderTripContentSections({
    result,
    destinationId,
    nights: plan.request.nights,
    locale,
    fallbackItinerary: [],
  });
  const root = document.getElementById("root")!;
  document.documentElement.lang = locale;
  root.dataset.ready = "true";
  root.dataset.destination = destinationId;
  root.dataset.attractions = String(result.content.attractions?.length ?? 0);
  root.dataset.areas = String(result.content.areas?.length ?? 0);
  root.dataset.transport = String(result.content.transport?.length ?? 0);
  root.dataset.practical = String(result.content.practicalNotes?.length ?? 0);
  root.dataset.templates = String(result.content.dayTemplates?.length ?? 0);
  root.dataset.sources = String(result.content.sources.length);
  root.dataset.estimatedSpend = String(plan.budget?.estimatedSpend.cents ?? "");
  createRoot(root).render(
    <AppRouterContext.Provider
      value={{
        bfcacheId: "reviewed-kyoto-verification",
        back() {},
        forward() {},
        refresh() {},
        push() {},
        replace() {},
        prefetch() {},
      }}
    >
      <aside
        className="pilot-draft-banner"
        aria-label="Local verification fixture"
      >
        <strong>LOCAL VERIFICATION — REVIEWED KYOTO</strong>
        <p>
          Synthetic trip frame. Content comes from the real reviewed runtime
          store; this is not a production search route.
        </p>
      </aside>
      <FullTrip
        base={base}
        initial={request}
        scenario="none"
        today={new Date(now).toISOString().slice(0, 10)}
        locale={locale}
        t={locale === "en" ? en : sq}
        contentSections={sections}
      />
    </AppRouterContext.Provider>,
  );
}
void main();
