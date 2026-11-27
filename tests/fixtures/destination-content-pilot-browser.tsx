/** Isolated local draft preview. Not a production route, flag, or publication path. */
import { createRoot } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { destinationContentData } from "../../content/destinations/records";
import {
  pilotContentData,
  pilotIdentities,
} from "./destination-experience-pilot";
import { placeRegistryData } from "../../content/places/records";
import type { PlaceIdentity } from "../../src/domain/media/types";
import { FullTrip } from "../../src/components/travel/FullTrip";
import { renderTripContentSections } from "../../src/components/travel/TripContent";
import { pricePlan } from "../../src/domain/pricing";
import { findLocation } from "../../src/catalogue/locations";
import { draftContentPreview } from "./destination-content-draft-preview";
import { costTrip } from "../cost-profile-fixtures";
import candidates from "../../docs/research/destination-media/phase2/candidates.json";
import { flightDestinations } from "../../src/catalogue/flight-destinations";
import en from "../../src/i18n/en.json";
import sq from "../../src/i18n/sq.json";

async function main() {
  const params = new URLSearchParams(location.search);
  const locale = params.get("locale") === "sq" ? "sq" : "en";
  const destinationId = params.get("destination") ?? "";
  const identities =
    params.get("pilot") === "phase2"
      ? pilotIdentities
      : (placeRegistryData.records as PlaceIdentity[]);
  const identity = identities.find((place) => place.subject === destinationId);
  if (!identity) throw Error("unknown-preview-identity");
  const now = Date.now();
  const nights = params.get("nights") === "3" ? 3 : 2;
  const candidate =
    params.get("pilot") === "phase2"
      ? candidates.candidates.find(
          (candidate) => candidate.destinationId === destinationId,
        )
      : undefined;
  const destination = flightDestinations.find(
    (place) => place.id === destinationId,
  );
  const result = await draftContentPreview(
    params.get("pilot") === "phase2"
      ? pilotContentData
      : destinationContentData,
    { identities, mediaSubjects: identities.map((place) => place.subject) },
    destinationId,
    now,
  );
  if (result.status !== "reviewed")
    throw Error(`draft-has-no-current-preview: ${result.reason}`);
  const { base, request } = costTrip("EUR");
  request.nights = nights;
  request.dates.endDate = `2026-11-${String(7 + nights).padStart(2, "0")}`;
  const origin = findLocation("zurich")!;
  base.id = destinationId;
  base.origin = origin;
  request.originId = origin.id;
  request.origin = origin;
  base.destination = {
    ...base.destination,
    id: destinationId,
    name: destination?.name ?? { en: identity.name, sq: identity.name },
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
    cityCode: destination?.cityCode ?? identity.cityCode,
    iataCodes: destination?.iataCodes ?? identity.iataCodes,
    coordinates: identity.coordinates,
    // Review-only clone, not a persisted media selection. The banner remains visible.
    heroImage:
      candidate && params.get("media") !== "none"
        ? {
            src: `/review-media/${destinationId}-1200.webp`,
            localVariants: candidate.variants.map((variant) => ({
              src: `/review-media/${destinationId}-${variant.width}.webp`,
              width: variant.width,
              height: variant.height,
            })),
            source: "local",
            sourceId: `phase2-review:${destinationId}`,
            author: candidate.author,
            attribution: `${candidate.author} · Wikimedia Commons · resized WebP · ${candidate.license.includes("4.0") ? "CC BY-SA 4.0" : "CC BY-SA 3.0"}`,
            license: candidate.license,
            photoUrl: candidate.sourcePage,
            destinationId,
            verification: "verified",
            localizedAlt: candidate.alt,
          }
        : undefined,
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
  root.dataset.nights = String(nights);
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
        bfcacheId: "destination-content-pilot-operator-preview",
        back() {},
        forward() {},
        refresh() {},
        push() {},
        replace() {},
        prefetch() {},
      }}
    >
      <aside className="pilot-draft-banner" aria-label="Draft review status">
        <strong>DRAFT — NOT PUBLISHED</strong>
        <p>
          {locale === "en"
            ? "Local content review only. English copy and photographs await human approval. Trip prices and dates below are synthetic UI fixtures."
            : "Vetëm për shqyrtim lokal. Teksti në shqip dhe anglisht pret miratimin njerëzor. Çmimet dhe datat më poshtë janë shembuj testimi."}
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
