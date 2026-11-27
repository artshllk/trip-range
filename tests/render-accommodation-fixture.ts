/** Local synthetic browser harness only; never imported by app routes or composition. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { BudgetPanel } from "../src/components/travel/Budget";
import {
  StayPrice,
  StayEvidenceDetails,
} from "../src/components/travel/StayEvidence";
import type { Dictionary } from "../src/i18n/dictionaries";
import { pricePlan } from "../src/domain/pricing";
import { costProfile, costTrip } from "./cost-profile-fixtures";
import { stayQuote, stayNow } from "./accommodation-fixtures";
import { createDestinationAccessStore } from "../src/travel/runtime/access-store";
import { createPlaceRegistry } from "../src/places/runtime/store";
import { placeRegistryData } from "../content/places/records";
import kyotoAccess from "../content/archive/cost-scope-2026-11-02/travel/access/place-Q34600.json";
const destinationAccessData = { schemaVersion: 1, records: [kyotoAccess] };
import { fxData } from "./fixtures/fx-frozen";
const destinationAccess = createDestinationAccessStore(
  destinationAccessData,
  createPlaceRegistry(placeRegistryData).list(),
  () => stayNow,
  fxData,
);
import { arrivalAccess } from "../src/domain/destination-access/arrival";
export const accommodationBrowserStates = [
  "provider",
  "reviewed",
  "generic",
  "failure",
  "simple",
  "comfort",
  "family",
  "kyoto",
  "unavailable",
] as const;
export function renderAccommodationFixture(
  locale: "en" | "sq",
  state: (typeof accommodationBrowserStates)[number],
  css: string,
) {
  const { base, request } = costTrip("EUR", "PAR", "FR");
  if (state === "family") {
    request.party = { adults: 2, children: 2 };
    request.preferences = { ...request.preferences, familyStay: true };
  }
  if (state === "simple" || state === "comfort")
    request.preferences = { ...request.preferences, stayLevel: state };
  if (state === "kyoto") {
    const access = destinationAccess.get("place:Q34600")!;
    base.destination = access.destination;
    base.id = base.destination.id;
    if (
      base.transport.mode === "flight" &&
      base.transport.flightPricing.kind === "priced"
    ) {
      const fare = base.transport.flightPricing.fare;
      fare.destinationCode = "OSA";
      fare.destinationAirport = "KIX";
      base.transport.arrival = arrivalAccess(access, fare, "EUR");
    }
  }
  const q = stayQuote(base, request);
  base.accommodationEvidence =
    state === "failure"
      ? { status: "unavailable", reason: "timeout" }
      : ["provider", "simple", "comfort", "family", "kyoto"].includes(state)
        ? { status: "available", quotes: [q] }
        : undefined;
  if (state === "unavailable") request.nights = 0;
  const plan = pricePlan(base, request, "none", undefined, {
    today: "2026-10-13",
    now: stayNow,
    profiles:
      state === "reviewed" ? [costProfile("city:PAR", "EUR", "FR")] : [],
  });
  const t: Dictionary = JSON.parse(
    readFileSync(`src/i18n/${locale}.json`, "utf8"),
  );
  const markup = renderToStaticMarkup(
    createElement(
      "div",
      { className: "stack" },
      createElement(StayPrice, { plan, locale }),
      createElement(StayEvidenceDetails, { plan, locale, allocation: true }),
      createElement(BudgetPanel, { plan, locale, t }),
    ),
  );
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Synthetic accommodation QA</title><style>${css}</style></head><body><main style="max-width:760px;margin:24px auto;padding:16px"><h1>Synthetic accommodation QA</h1><p>Test evidence only — never live availability.</p><section class="trip-budget stack" data-completeness="${plan.pricingCompleteness}" data-expected-spend="${plan.budget?.estimatedSpend.cents ?? "unavailable"}">${markup}</section></main></body></html>`;
}
