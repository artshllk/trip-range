import { customPlannerEnabled } from "../src/config/features";
import { destinationCollection } from "./fixtures/archived-destination-data";
// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import { test } from "node:test";
import { emptyIntent } from "../src/domain/ai/intent";
import { resolveTravelIntent } from "../src/services/ai/resolve-intent";
import assert from "node:assert/strict";
import { CHILD_INPUT, renderInChild } from "./child-render";
import { readFileSync } from "node:fs";
import {
  discoveryContext,
  discoveryHref,
  discoveryRequest,
  discoveryRequestQuery,
  planDestinationHref,
  discoveryStyles,
} from "../src/domain/destination-discovery";
import {
  loadDestinationGuide,
  getDestinationGuides,
} from "./fixtures/archived-destination-data";
import { readLocation, decodeLocation } from "../src/domain/locations";
import { parseRequest, requestQuery } from "../src/domain/request";
import {
  destinationMetadata,
  destinationSitemap,
} from "../src/seo/destinations";
import { createPinnedDestinationContentStore } from "../src/content/runtime/publication";
import { destinationContentData } from "./fixtures/archived-destination-data";
import { destinationContentValidationContext } from "./fixtures/archived-destination-data";
import type { DestinationContentData } from "../src/domain/destination-content/types";
import { destinationAccess } from "./fixtures/archived-destination-data";
import { placeIdentities } from "../src/places/runtime/registry";
import { approvedPlaceMedia } from "../src/media/runtime/approved";
import { trustedImageFixture } from "./destination-image-fixtures";
import { budgetMediaFixture } from "./fixtures/budget-media";
import { pricePlan } from "../src/domain/pricing";
import en from "../src/i18n/en.json";

const today = "2026-10-22";
const query = {
  origin: "zurich",
  budget: "1450",
  currency: "CHF",
  adults: "3",
  children: "2",
  start: "2026-11-20",
  end: "2026-11-23",
  flexDays: "3",
  styles: "city,quiet",
  stay: "comfort",
  airports: "1",
  luggage: "1",
  arrivalFor: "place:Q60",
  arrival: "JFK",
};

test("worldwide discovery never infers PRN, but retains explicit origins and full planning inputs", () => {
  for (const q of [{}, { currency: "USD" }, { origin: "unrecognized" }]) {
    const request = discoveryRequest(q, today);
    assert.equal(request.originId, "");
    assert.equal(request.origin, undefined);
    assert.equal("origin" in discoveryRequestQuery(request), false);
  }
  const request = discoveryRequest(query, today);
  assert.equal(request.originId, "zurich");
  assert.deepEqual(request.party, { adults: 3, children: 2 });
  assert.equal(request.budget.cents, 145000);
  assert.equal(request.budget.currency, "CHF");
  assert.equal(request.dates.startDate, query.start);
  assert.equal(request.dates.endDate, query.end);
  assert.deepEqual(request.styles, ["city", "quiet"]);
  const worldwide = {
    id: "airport:SYD",
    type: "airport",
    airportIata: "SYD",
    name: "Sydney",
    countryCode: "AU",
    countryName: { en: "Australia", sq: "Australia" },
  };
  const foreign = discoveryRequest(
    { ...query, originPlace: JSON.stringify(worldwide) },
    today,
  );
  assert.equal(foreign.origin?.airportIata, "SYD");
  assert.equal(foreign.originId, "airport:SYD");
});

test("destination browsing and planning preserve inputs while clearing previous-destination arrival hints", async () => {
  for (const [slug, city, subject] of [
    ["vienna", "VIE", "vienna"],
    ["london", "LON", "london"],
    ["paris", "PAR", "paris"],
    ["new-york", "NYC", "place:Q60"],
  ]) {
    const guide = await loadDestinationGuide(slug);
    assert.ok(guide);
    assert.equal(guide.card.subject, subject);
    assert.equal(readLocation(guide.target)?.cityCode, city);
    assert.equal(
      guide.target?.airportIata,
      undefined,
      "city groups cannot invent an operating airport",
    );
    const browse = new URL(
      discoveryHref(`/destinations/${slug}`, query),
      "https://example.test",
    );
    const plan = new URL(
      planDestinationHref(
        guide.target,
        Object.fromEntries(browse.searchParams),
      ),
      "https://example.test",
    );
    assert.equal(plan.pathname, "/");
    assert.equal(plan.hash, "#search");
    for (const key of [
      "origin",
      "budget",
      "currency",
      "adults",
      "children",
      "start",
      "end",
      "styles",
      "stay",
      "luggage",
    ] as const)
      assert.equal(plan.searchParams.get(key), query[key]);
    assert.equal(plan.searchParams.has("arrival"), false);
    assert.equal(plan.searchParams.has("arrivalFor"), false);
    assert.equal(
      decodeLocation(plan.searchParams.get("toPlace")!)?.cityCode,
      city,
    );
    const restored = discoveryRequest(
      Object.fromEntries(plan.searchParams),
      today,
    );
    assert.equal(restored.destination?.cityCode, city);
    assert.deepEqual(restored.party, { adults: 3, children: 2 });
    assert.equal(
      parseRequest(
        Object.fromEntries(new URLSearchParams(requestQuery(restored))),
        undefined,
        today,
      ).destination?.cityCode,
      city,
    );
  }
  assert.equal(
    new URL(
      planDestinationHref(undefined, { ...query, toPlace: "old" }),
      "https://example.test",
    ).searchParams.has("toPlace"),
    false,
  );
  assert.equal(
    discoveryContext({ ...query, secret: "not-for-propagation", ai: "1" }).has(
      "secret",
    ),
    false,
  );
  assert.equal(discoveryContext({ origin: ["zurich", "prishtina"] }).size, 0);
  assert.deepEqual(
    discoveryStyles.map((style) => style.id),
    ["city", "nature", "quiet", "beach"],
  );
});

test("approved Barcelona and Batch 1 guides prefill city targets without changing inputs", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    assert.fail("Guide navigation must not call a provider"),
  );
  const identities = structuredClone(placeIdentities);
  for (const [slug, subject, city] of [
    ["barcelona", "city:BCN", "BCN"],
    ["istanbul", "istanbul", "IST"],
    ["singapore", "place:Q334", "SIN"],
    ["mexico-city", "place:Q1489", "MEX"],
  ]) {
    const guide = await loadDestinationGuide(slug);
    assert.ok(guide);
    assert.equal(guide.card.subject, subject);
    assert.equal(guide.target?.cityCode, city);
    assert.equal(guide.target?.airportIata, undefined);
    const href = new URL(
      planDestinationHref(guide.target, query),
      "https://example.test",
    );
    for (const [key, value] of Object.entries(query))
      if (!["arrival", "arrivalFor"].includes(key))
        assert.equal(href.searchParams.get(key), value, `${slug}:${key}`);
    assert.equal(href.searchParams.has("arrival"), false);
    assert.equal(href.searchParams.has("arrivalFor"), false);
    assert.equal(
      decodeLocation(href.searchParams.get("toPlace")!)?.cityCode,
      city,
    );
    const request = discoveryRequest(
      Object.fromEntries(href.searchParams),
      today,
    );
    assert.equal(request.destination?.cityCode, city);
    assert.deepEqual(request.party, { adults: 3, children: 2 });
    assert.equal(request.budget.currency, "CHF");
    assert.deepEqual(request.dates, {
      startDate: query.start,
      endDate: query.end,
      flexibleDays: 3,
    });
    const restored = parseRequest(
      Object.fromEntries(new URLSearchParams(requestQuery(request))),
      undefined,
      today,
    );
    assert.equal(restored.destination?.cityCode, city);
    const withoutOrigin = new URL(
      planDestinationHref(guide.target, {}),
      "https://example.test",
    );
    assert.equal(withoutOrigin.searchParams.has("origin"), false);
  }
  assert.deepEqual(
    placeIdentities,
    identities,
    "canonical identities are unchanged",
  );
});

test("identity fallback cannot override explicit direct, gateway or mixed access", async (t) => {
  const get = destinationAccess.get.bind(destinationAccess);
  const direct = get("place:Q334")!;
  const gateway = get("place:Q34600")!;
  const mixed = get("place:Q24451")!;
  assert.ok(direct.directCity);
  assert.ok(gateway.gateways.length && !gateway.directCity);
  assert.ok(mixed.directEntries?.length && mixed.gateways.length);
  // Exercise precedence with real access objects under a synthetic lookup override.
  // No identity, access record, operational airport or publication data is changed.
  const snapshots = structuredClone([direct, gateway, mixed]);
  const lookup = t.mock.method(destinationAccess, "get", get);
  for (const access of [direct, gateway, mixed]) {
    lookup.mock.mockImplementation((id) =>
      id === "city:BCN" ? access : get(id),
    );
    const guide = await loadDestinationGuide("barcelona");
    assert.ok(guide);
    assert.equal(guide.target?.cityCode, access.directCity?.providerCityCode);
    assert.equal(guide.target?.airportIata, undefined);
  }
  assert.deepEqual([direct, gateway, mixed], snapshots);
});

test("small curated collection uses actual receipts and role approvals, makes zero provider calls", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    assert.fail("Discovery must not call providers"),
  );
  const guides = await getDestinationGuides();
  assert.equal(guides.length, 16);
  assert.deepEqual(
    guides.map((g) => g.card.slug),
    destinationCollection.map((e) => e.slug),
  );
  for (const guide of guides) {
    assert.ok(guide.card.description.length > 60);
    assert.equal(guide.result.status, "reviewed");
    assert.equal(guide.card.image?.destinationId, guide.card.subject);
    if (guide.card.image)
      assert.deepEqual(
        guide.card.image.localVariants?.map((v) => v.width),
        ["vienna", "london", "paris", "istanbul", "barcelona"].includes(
          guide.card.slug,
        )
          ? [320, 640, 800, 1200, 1920]
          : [640, 1200, 1920],
      );
    assert.ok(!("result" in guide.card));
  }
  assert.equal(
    await loadDestinationGuide("lisbon"),
    undefined,
    "no mass publication",
  );
  for (const state of ["draft", "changed", "expired"] as const) {
    const data = structuredClone(
      destinationContentData,
    ) as DestinationContentData;
    const record = data.records.find((r) => r.destinationId === "vienna")!;
    if (state === "draft") record.reviewStatus = "draft";
    if (state === "changed")
      record.overview!.text.en += " Changed after approval.";
    const store = createPinnedDestinationContentStore(
      data,
      destinationContentValidationContext,
      () =>
        Date.parse(
          state === "expired" ? "2028-01-01T00:00:00Z" : "2026-10-22T12:00:00Z",
        ),
    );
    assert.equal(await loadDestinationGuide("vienna", store), undefined, state);
  }
});

test("evergreen metadata and sitemap have stable English URLs and no request-specific publication", async () => {
  const guides = await getDestinationGuides();
  // Guides are noindex under the G1–G4 gate (G3), so none enter the sitemap.
  assert.ok(guides.length > 0);
  assert.deepEqual(
    destinationSitemap(guides.map((g) => ({ card: g.card }))),
    [],
  );
  for (const guide of guides) {
    const metadata = destinationMetadata(guide.card);
    assert.equal(
      metadata.alternates?.canonical,
      `https://www.trip-range.com/destinations/${guide.card.slug}`,
    );
    assert.deepEqual(metadata.robots, { index: false, follow: true });
    assert.deepEqual(metadata.alternates?.languages, {
      en: metadata.alternates?.canonical,
      "x-default": metadata.alternates?.canonical,
    });
  }
  assert.deepEqual(destinationSitemap([]), []);
  for (const file of [
    "src/app/[locale]/plan/results/page.tsx",
    "src/app/[locale]/plan/trips/[id]/page.tsx",
  ])
    assert.match(readFileSync(file, "utf8"), /index: false/);
});

function render(
  component:
    | "HomeExperience"
    | "DestinationGuide"
    | "DestinationCards"
    | "ResultCard"
    | "FullTrip",
  props: Record<string, unknown>,
) {
  return renderInChild(
    `
    const {createElement:h}=require('react'); const {renderToStaticMarkup}=require('react-dom/server');
    const {AppRouterContext}=require('next/dist/shared/lib/app-router-context.shared-runtime');
    const {buildSync}=require('esbuild'); const Module=require('node:module'); const path=require('node:path'); const filename=path.resolve('src/components/${["ResultCard", "FullTrip"].includes(component) ? "travel" : "discovery"}/${component}.tsx'); const code=buildSync({entryPoints:[filename],bundle:true,platform:'node',packages:'external',write:false}).outputFiles[0].text; const compiled=new Module(filename); compiled.paths=module.paths; compiled._compile(code,filename); const {${component}}=compiled.exports;
    const props=${CHILD_INPUT}; const router={bfcacheId:'phase3-test',back(){},forward(){},refresh(){},push(){},replace(){},prefetch(){}};
    globalThis.fetch=async()=>{throw Error('Unexpected provider request');};
    process.stdout.write(renderToStaticMarkup(h(AppRouterContext.Provider,{value:router},h(${component},props))));
  `,
    props,
  );
}

test("Mexico City photo credits stay visible in guides, discovery cards, results and trip heroes without bypassing approval", async () => {
  const guide = await loadDestinationGuide("mexico-city");
  assert.ok(guide);
  const image = {
    ...trustedImageFixture,
    destinationId: "place:Q1489",
    sourceId: "wikimedia-commons:139259979",
    src: "/destinations/qa-mexico-1200.webp",
    localVariants: [640, 1200, 1920].map((width) => ({
      src: `/destinations/qa-mexico-${width}.webp`,
      width,
      height: Math.round((width * 9) / 16),
    })),
    author: "ProtoplasmaKid",
    attribution:
      "© ProtoplasmaKid / Wikimedia Commons / CC BY-SA 4.0 · resized to WebP; cropped for display",
    photoUrl:
      "https://commons.wikimedia.org/wiki/File:Vista_a%C3%A9rea_del_Palacio_Bellas_Artes.jpg",
    license: "https://creativecommons.org/licenses/by-sa/4.0/",
  };
  for (const [label, patch] of [
    ["displayed", {}],
    ["unverified", { verification: "unverified" as const }],
    ["wrong destination", { destinationId: "vienna" }],
  ] as const) {
    const photo = { ...image, ...patch };
    const { base, request } = budgetMediaFixture("unpriced");
    base.destination = {
      ...base.destination,
      id: "place:Q1489",
      name: { en: "Mexico City", sq: "Mexico City" },
      image: photo,
      heroImage: photo,
    };
    for (const html of [
      render("DestinationGuide", {
        guide: { ...guide, heroImage: photo },
        query,
      }),
      render("DestinationCards", {
        cards: [{ ...guide.card, image: photo }],
        query,
      }),
      render("ResultCard", {
        plan: pricePlan(base, request),
        locale: "en",
        t: en,
        index: 0,
        currentYear: "2026",
      }),
      render("FullTrip", {
        base,
        initial: request,
        locale: "en",
        t: en,
        today,
        scenario: "none",
      }),
    ]) {
      if (label === "displayed") {
        const visible = html.match(
          /<p class="(?:destination-credit|photo-caption)">([\s\S]*?)<\/p>/,
        )?.[1];
        assert.ok(
          visible,
          "credit is visible outside details/popovers in every reused role",
        );
        assert.match(
          visible,
          /© ProtoplasmaKid \/ Wikimedia Commons \/ CC BY-SA 4\.0/,
        );
        assert.match(visible, /resized to WebP; cropped for display/);
        assert.ok(visible.includes(image.photoUrl));
        assert.ok(visible.includes(image.license));
        assert.doesNotMatch(html, /<details class="destination-credit">/);
        assert.doesNotMatch(
          html,
          /class="trip-photo-credit"|class="result-photo-credit"/,
        );
        assert.match(html, /qa-mexico-640\.webp 640w/);
        assert.match(html, /qa-mexico-1920\.webp 1920w/);
      } else {
        assert.doesNotMatch(
          html,
          /class="destination-credit"|ProtoplasmaKid|commons:139259979/,
        );
      }
    }
  }
  for (const role of ["destination.hero", "destination.card"] as const)
    assert.equal(
      (await approvedPlaceMedia.get("place:Q1489", role)).status,
      "approved",
    );
  const vienna = await loadDestinationGuide("vienna");
  assert.ok(vienna);
  const unchanged = render("DestinationGuide", { guide: vienna, query });
  assert.match(
    unchanged,
    /<details class="destination-credit"><summary>Photo credit and licence<\/summary>/,
  );
  assert.doesNotMatch(unchanged, /<p class="destination-credit">/);
});

test("real homepage and guide markup show useful reviewed content, honest prices and preserved planning links", async () => {
  const guides = await getDestinationGuides();
  const props = {
    initial: discoveryRequest(query, today),
    today,
    cards: guides.map((g) => g.card),
    targets: Object.fromEntries(guides.map((g) => [g.card.subject, g.target])),
    t: JSON.parse(readFileSync("src/i18n/en.json", "utf8")),
  };
  const home = render("HomeExperience", props);
  assert.match(home, /Tell us your budget\./);
  assert.match(home, /We’ll find the trip\./);
  assert.doesNotMatch(
    home,
    /weekend ideas from Prishtina|popular|trending|Estimated trip/,
  );
  assert.equal((home.match(/class="destination-card"/g) || []).length, 12);
  assert.equal(
    (home.match(/class="home-guide(?: home-guide-featured)?"/g) || []).length,
    4,
  );
  assert.ok(
    home.indexOf('data-field="budget"') < home.indexOf('data-field="from"'),
  );
  assert.match(home, /Trips to Vienna/);
  assert.match(home, /Read Vienna guide/);
  assert.doesNotMatch(home, /no photo selected/);
  for (const name of ["Paris", "New York City"])
    assert.equal(
      (home.match(new RegExp(`<h3[^>]*>(?:<a[^>]*>)?${name}`, "g")) || [])
        .length,
      1,
    );
  assert.match(home, /20–23 Nov ±3 · 3 nights/);
  assert.doesNotMatch(home, /2026-11-20 → 2026-11-23/);
  assert.match(home, /CHF 1,450/);
  // Crawlable hrefs stay clean; search context is carried on click only.
  for (const href of home.match(/href="[^"]*"/g) ?? [])
    assert.doesNotMatch(href, /budget=|adults=|start=|currency=/, href);
  assert.match(home, /City breaks/);
  for (const guide of guides) {
    const html = render("DestinationGuide", { guide });
    if (customPlannerEnabled) {
      assert.match(html, /class="button ember"[^>]*>Plan a trip here/);
      assert.match(html, /Missing flight or required transfer prices/);
    } else {
      // Planner off (src/config/features.ts): guides point to the
      // flight view and make no whole-trip claim.
      assert.match(html, /class="button ember" href="\/plan">See flights/);
      assert.doesNotMatch(
        html,
        /Your whole-trip budget|Missing flight or required transfer/,
      );
    }
    assert.match(html, /Worth seeing/);
    assert.match(html, /Sources/);
    for (const href of html.match(/href="\/[^"]*"/g) ?? [])
      assert.doesNotMatch(href, /budget=|adults=|start=|currency=/, href);
    assert.doesNotMatch(html, /DRAFT|localhost|review-media/);
    if (guide.card.slug === "vienna") {
      assert.match(html, /Upper and Lower Belvedere are distinct visits/);
      assert.match(html, /vienna-640.webp 640w/);
    }
    if (guide.card.slug === "london") {
      assert.match(html, /Sundays are for worship/);
      assert.match(html, /More transport details/);
    }
  }
});

test("AI on an unselected-origin homepage requires clarification rather than applying a default airport", async () => {
  const request = discoveryRequest({}, today);
  const result = await resolveTravelIntent(
    emptyIntent,
    discoveryRequestQuery(request),
    "Somewhere quiet",
    today,
    {
      async search() {
        assert.fail("No extracted location, no provider lookup");
      },
    },
  );
  assert.equal(result.status, "clarification");
  assert.ok(result.clarifications.some((item) => item.field === "origin"));
});
