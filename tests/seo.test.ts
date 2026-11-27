import { completePlan, matchingFlight } from "../src/domain/flight-pricing";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  seoLandingRegistry,
  approvedLanding,
  relatedLandings,
  canonicalFor,
  siteUrl,
  type SeoLandingDefinition,
} from "../src/seo/registry";
import {
  seoQuality,
  editorialQuality,
  canonicalIntent,
  validEditorialIntent,
} from "../src/seo/policy";
import {
  storedDecision,
  validDecision,
  gateReviewProblems,
  indexingDecisions,
  type GateReview,
  type IndexingDecision,
  type HubEvidence,
} from "../src/seo/indexing";
import robots from "../src/app/robots";
import { routePath } from "../src/seo/identity";
import { seoRequest, seoSearchHref } from "../src/seo/summary";
import {
  landingModel,
  landingMetadata,
  seoSitemap,
  breadcrumbs,
  breadcrumbSchema,
  organizationSchema,
  jsonLd,
} from "../src/seo/publication";
import { budgetMethodology, fareDisclosure } from "../src/seo/content";
import { loadSeoSearch } from "./flight-provider-fixture";
import { translatedPath } from "../src/i18n/config";
import { sanitizeAnalyticsEvent } from "../src/domain/analytics";
import type { TripTemplate, FlightDiscoveryFare } from "../src/domain/types";
import type { TripSearch } from "../src/services/travel";
import { flightDestinations as destinations } from "../src/catalogue/flight-destinations";
const today = "2026-10-07",
  now = "2026-10-07T12:00:00Z";
const page = seoLandingRegistry[2],
  request = seoRequest(page, today);
function fixtures(): TripSearch {
  const templates: TripTemplate[] = destinations
    .slice(0, 4)
    .map((destination, i) => {
      const price = {
        amount: { cents: 1000 + i * 100, currency: "EUR" as const },
        confidence: "recent" as const,
        source: { status: "available" as const },
        providerId: "travelpayouts-aviasales-data",
        observedAt: "2026-10-06T12:00:00Z",
        demo: false,
      };
      const flight: FlightDiscoveryFare = {
        originCode: "ZRH",
        destinationCode: ["VIE", "ROM", "BER", "MIL"][i],
        price,
        scope: {
          unit: "per-traveller",
          journey: "return",
          dates: request.dates,
          fees: "provider-unspecified",
        },
        retrievedAt: "2026-10-07T10:00:00Z",
      };
      return {
        id: destination.id,
        origin: page.origin,
        destination,
        transport: {
          mode: "flight",
          flightPricing: { kind: "priced", quote: price, fare: flight },
        },
        stay: {
          ...price,
          providerId: "goeksplo-stay-estimate",
          confidence: "estimate",
          amount: { cents: 8000, currency: "EUR" },
          observedAt: null,
        },
        itinerary: [],
      };
    });
  return { templates, issues: [] };
}
const model = () =>
  landingModel(page, { state: "ready", search: fixtures() }, today, now);
test("exactly four English SEO routes are explicitly approved; unlisted families stay absent", () => {
  assert.equal(seoLandingRegistry.length, 4);
  assert.deepEqual(
    seoLandingRegistry.slice(3).map((p) => p.path),
    ["/from/tirana"],
  );
  for (const p of seoLandingRegistry) {
    assert.equal(p.locale, "en");
    assert.ok(approvedLanding(p.path));
  }
  for (const path of [
    "/from",
    "/research",
    "/from/skopje",
    "/from/prishtina",
    "/from/london",
    "/from/basel",
    "/sq/from/zurich",
    "/from/zurich/weekend-trips-under-300",
    "/from/prishtina/weekend-trips/under-300",
    "/from/zurich/weekend-trips-under-700",
    "/from/zurich/weekend-trips-under-500?budget=50",
    "/plan/results",
  ])
    assert.equal(approvedLanding(path), undefined);
});
test("editorial title/H1 alignment, unique primary intent and no keyword insertion", () => {
  for (const p of seoLandingRegistry) {
    assert.equal(validEditorialIntent(p), true);
    assert.ok(p.title.endsWith(" — Trip Range"));
    assert.ok(p.description.includes("trip"));
  }
  assert.equal(new Set(seoLandingRegistry.map(canonicalIntent)).size, 4);
  assert.equal(
    validEditorialIntent({
      ...page,
      intro: page.keywords.primary + " " + page.keywords.primary,
    }),
    false,
  );
  assert.equal(
    validEditorialIntent({ ...page, title: "WEEKEND WEEKEND CHEAP CHEAP" }),
    false,
  );
  const component = readFileSync("src/components/seo/SeoLanding.tsx", "utf8");
  assert.equal(component.includes(".keywords"), false);
});
test("editorial quality requires approved intent, valid origin and sections", () => {
  for (const p of seoLandingRegistry)
    assert.deepEqual(
      editorialQuality(p).reasons,
      ["editorially valid"],
      p.path,
    );
  for (const candidate of [
    { ...page, approved: false },
    { ...page, path: "/from/unlisted" },
    { ...page, origin: { ...page.origin, countryCode: "unknown" } },
    { ...page, sections: ["results"] },
    { ...page, locale: "sq" },
    { ...page, type: "origin" },
    { ...page, budget: { cents: 50000, currency: "GBP" } },
  ] as SeoLandingDefinition[])
    assert.equal(editorialQuality(candidate).indexable, false);
  assert.equal(
    editorialQuality(page, [
      ...seoLandingRegistry,
      { ...page, id: "duplicate" as typeof page.id },
    ]).indexable,
    false,
  );
});
const snapshotAt = "2026-11-05T10:00:00.000Z";
const hubEvidence: HubEvidence = {
  kind: "hub-v1",
  source: "fare-store",
  snapshotAt,
  originCode: "ZRH",
  qualifyingDestinations: ["BER", "MIL", "VIE"],
};
const gate: GateReview = {
  version: "g1-g4-v1",
  integrity: {
    checkedOn: "2026-11-05",
    unsourcedFigures: 0,
    unnamedUnknowns: 0,
  },
  question: "Where can two of us fly from Zurich for two nights?",
  informationGain: {
    query: "weekend trips from zurich",
    serpCheckedOn: "2026-11-01",
    topResults: ["Result A", "Result B", "Result C"],
    gain: "Synthetic: a sourced figure the top results do not show.",
  },
  maintenance: {
    refresh: "Synthetic weekly refresh.",
    withdrawWhen: "Synthetic: figures lapse.",
  },
  reviewer: "test",
};
const indexed = (pageId = page.id): IndexingDecision => ({
  pageId,
  decision: "index",
  reviewedOn: "2026-11-05",
  reviewBy: "2027-02-05",
  basis: "Synthetic stored-evidence review.",
  gate,
  evidence: hubEvidence,
});
test("live data never changes robots or the sitemap; only the stored decision does", () => {
  const states = [
    "ready",
    "configuration",
    "provider",
    "timeout",
    "rate-limit",
    "invalid-calculation",
  ] as const;
  for (const state of states) {
    const m = landingModel(page, { state, search: fixtures() }, today, now);
    assert.equal(m.quality.indexable, seoQuality(page).indexable, state);
  }
  // Stored noindex today; the same static answer with or without provider data.
  assert.equal(seoQuality(page).indexable, false);
  assert.equal(
    seoQuality(page, seoLandingRegistry, [indexed()]).indexable,
    true,
  );
  for (const fn of [landingMetadata, seoSitemap, seoQuality, editorialQuality])
    assert.equal(/summary|state|fetch/.test(fn.toString()), false, fn.name);
});
test("stored decisions fail closed: missing, duplicate, malformed or unsupported index records are noindex", () => {
  assert.equal(storedDecision(page.id, []), undefined);
  assert.equal(storedDecision(page.id, [indexed(), indexed()]), undefined);
  for (const bad of [
    { ...indexed(), gate: undefined },
    {
      ...indexed(),
      gate: { ...gate, integrity: { ...gate.integrity, unsourcedFigures: 1 } },
    },
    {
      ...indexed(),
      gate: { ...gate, integrity: { ...gate.integrity, unnamedUnknowns: 2 } },
    },
    { ...indexed(), gate: { ...gate, question: "" } },
    {
      ...indexed(),
      gate: {
        ...gate,
        informationGain: {
          ...gate.informationGain,
          serpCheckedOn: "2026-09-01",
        },
      },
    },
    {
      ...indexed(),
      gate: {
        ...gate,
        informationGain: { ...gate.informationGain, topResults: ["A", "B"] },
      },
    },
    {
      ...indexed(),
      gate: { ...gate, maintenance: { refresh: "", withdrawWhen: "" } },
    },
    { ...indexed(), reviewedOn: "5 Nov 2026" },
    { ...indexed(), reviewBy: "2026-11-05" },
    { ...indexed(), basis: "ok" },
    { ...indexed(), reviewedOn: "2026-11-04" }, // evidence newer than review
  ] as IndexingDecision[]) {
    assert.equal(validDecision(bad), false, JSON.stringify(bad));
    assert.equal(seoQuality(page, seoLandingRegistry, [bad]).indexable, false);
  }
  // A noindex record needs no evidence.
  assert.equal(
    validDecision({ ...indexed(), decision: "noindex", evidence: undefined }),
    true,
  );
  for (const record of indexingDecisions)
    assert.equal(validDecision(record), true, record.pageId);
  assert.equal(
    new Set(indexingDecisions.map((d) => d.pageId)).size,
    indexingDecisions.length,
  );
});
test("the G1–G4 review is the gate; a stored fare count is context, not a minimum", () => {
  assert.deepEqual(gateReviewProblems(gate, "2026-11-05"), []);
  // Fewer than three destinations no longer blocks an otherwise passing review.
  assert.equal(
    validDecision({
      ...indexed(),
      evidence: { ...hubEvidence, qualifyingDestinations: ["BER"] },
    }),
    true,
  );
  // No stored-fare context is needed at all for a non-hub page.
  assert.equal(validDecision({ ...indexed(), evidence: undefined }), true);
  assert.match(gateReviewProblems(undefined, "2026-11-05")[0], /G1–G4/);
});
test("robots.txt blocks the provider-backed planner, not the crawlable planner form", () => {
  const rules = robots().rules as { disallow: string[] };
  assert.deepEqual(rules.disallow, ["/api/", "/plan/"]);
  for (const blocked of ["/plan/results?origin=tirana", "/plan/trips/vienna"])
    assert.ok(
      rules.disallow.some((d) => blocked.startsWith(d)),
      blocked,
    );
  for (const open of ["/", "/plan", "/destinations/vienna", "/from/tirana"])
    assert.ok(!rules.disallow.some((d) => open.startsWith(d)), open);
});
test("truthful summary counts distinct evaluated destinations, not airport variants or display limit", () => {
  const search = fixtures();
  search.templates.push({ ...search.templates[0] });
  const m = landingModel(page, { state: "ready", search }, today, now);
  assert.equal(m.summary.destinationsChecked, 4);
  assert.equal(m.summary.fitsCount, 3); // Zurich's property charge cannot claim a fit.
  assert.equal(m.cards.length, 3);
  assert.equal(m.summary.recentFareCount, 3);
  assert.equal(
    m.summary.cheapestBudgetNeeded!.cents,
    m.summary.cheapestEstimatedSpend!.cents + m.cheapest!.safetyBuffer.cents,
  );
  const empty = landingModel(
    page,
    { state: "ready", search: { templates: [], issues: [] } },
    today,
    now,
  );
  assert.equal(empty.summary.destinationsChecked, 0);
  assert.equal(empty.summary.cheapestBudgetNeeded, null);
  assert.equal(empty.summary.lowestCostDestination, null);
  assert.equal(empty.quality.indexable, false);
});
test("monthly reference routes inform discovery but never become requested-date recent flight prices", () => {
  const search = fixtures();
  for (const t of search.templates) {
    const fare = matchingFlight(t.transport)!;
    t.transport = {
      mode: "flight",
      flightPricing: {
        kind: "reference",
        referenceFare: {
          ...fare,
          scope: {
            ...fare.scope,
            dates: {
              startDate: "2026-10-20",
              endDate: "2026-10-22",
              flexibleDays: 0,
            },
          },
        },
      },
    };
  }
  const m = landingModel(page, { state: "ready", search }, today, now);
  assert.equal(m.summary.recentFareCount, 0);
  assert.equal(m.summary.unpricedFlightCount, 4);
  assert.equal(m.summary.referenceFareCount, 4);
  assert.equal(m.summary.providerSupportedCount, 0);
  assert.equal(m.summary.completeCalculationCount, 0);
  assert.equal(m.summary.fitsCount, 0);
  assert.equal(m.quality.indexable, false);
  assert.ok(m.cards.every((p) => p.costs[0].confidence === "estimate"));
});
test("no affordable fit keeps bounded comparisons with their true over-budget status", () => {
  const search = fixtures();
  search.templates = search.templates.filter(
    (t) => t.destination.id !== "zurich",
  );
  for (const t of search.templates) t.stay.amount.cents = 100000;
  const m = landingModel(page, { state: "ready", search }, today, now);
  assert.equal(m.summary.fitsCount, 0);
  assert.equal(m.quality.indexable, false);
  assert.equal(m.cards.length, 3);
  assert.ok(m.cards.every((p) => completePlan(p) && p.budget.fit === "over"));
  assert.equal(
    m.summary.cheapestBudgetNeeded!.cents,
    m.cheapest!.budget.budgetNeeded.cents,
  );
});
test("freshness derives only from provider observation metadata, never retrieval or render time", () => {
  const search = fixtures();
  for (const t of search.templates)
    matchingFlight(t.transport)!.price.observedAt = null;
  const first = landingModel(page, { state: "ready", search }, today, now);
  assert.equal(first.summary.observationRange, null);
  matchingFlight(search.templates[0].transport)!.price.observedAt =
    "2030-01-01T00:00:00Z";
  assert.equal(
    landingModel(page, { state: "ready", search }, today, now).summary
      .observationRange,
    null,
  );
  const actual = model();
  assert.deepEqual(actual.summary.observationRange, {
    first: "2026-10-06",
    last: "2026-10-06",
  });
});
test("source failure keeps the route, its metadata and its sitemap state unchanged", () => {
  const good = model();
  const bad = landingModel(
    page,
    { state: "provider", search: fixtures() },
    today,
    now,
  );
  assert.deepEqual(landingMetadata(good.page), landingMetadata(bad.page));
  assert.equal(bad.cards.length, 3);
  assert.equal(
    landingMetadata(page).alternates!.canonical,
    siteUrl + page.path,
  );
});
test("query filters do not create new indexable/canonical URLs", () => {
  assert.equal(
    (landingMetadata(page, true).robots as { index: boolean }).index,
    false,
  );
  assert.equal(
    landingMetadata(page, true).alternates!.canonical,
    siteUrl + page.path,
  );
  for (const p of seoLandingRegistry)
    assert.equal(canonicalFor(p), siteUrl + p.path);
  assert.equal(
    JSON.stringify(landingMetadata(page)).includes("keywords"),
    false,
  );
  // English is en and x-default; no fabricated Albanian equivalent.
  assert.deepEqual(landingMetadata(page).alternates!.languages, {
    en: siteUrl + page.path,
    "x-default": siteUrl + page.path,
  });
});
test("sitemap lists the homepage and stored index decisions, dated by review", () => {
  assert.deepEqual(
    seoSitemap([]).map((e) => e.url),
    [siteUrl],
  );
  assert.ok(
    !("lastModified" in seoSitemap([])[0]),
    "no invented homepage date",
  );
  const entries = seoSitemap([indexed()]);
  assert.deepEqual(entries.slice(1), [
    { url: siteUrl + page.path, lastModified: "2026-11-05" },
  ]);
  assert.ok(
    entries.every(
      (e) =>
        !/[?#]/.test(e.url) &&
        !e.url.includes("/plan") &&
        !e.url.includes("/research"),
    ),
  );
  // A decision for an unregistered page publishes nothing.
  assert.equal(
    seoSitemap([indexed("en-unlisted-origin" as typeof page.id)]).length,
    1,
  );
});
test("internal links and visible breadcrumb hierarchy use only existing approved routes", () => {
  for (const p of seoLandingRegistry) {
    for (const link of relatedLandings(p))
      assert.ok(approvedLanding(link.path));
    for (const c of breadcrumbs(p).slice(1))
      assert.ok(approvedLanding(new URL(c.url).pathname));
  }
  assert.deepEqual(
    breadcrumbs(page).map((b) => b.name),
    ["Trip Range", "From Zurich", "Weekend trips", "Under €500"],
  );
  const schema = breadcrumbSchema(page);
  assert.equal(schema["@type"], "BreadcrumbList");
  schema.itemListElement.forEach((e, i) => {
    assert.equal(e.position, i + 1);
    assert.equal(e["@type"], "ListItem");
    assert.equal(e.item, breadcrumbs(page)[i].url);
  });
});
test("structured data is factual identity and visible breadcrumbs only, with safe serialization", () => {
  assert.deepEqual(Object.keys(organizationSchema).sort(), [
    "@context",
    "@type",
    "logo",
    "name",
    "url",
  ]);
  assert.equal(organizationSchema.name, "Trip Range");
  const raw = jsonLd([organizationSchema, breadcrumbSchema(page)]);
  assert.equal(
    /Offer|Review|AggregateRating|Product|Hotel|price|availability/.test(raw),
    false,
  );
  assert.equal(
    jsonLd({ name: "</script><script>attack</script>" }).includes("<"),
    false,
  );
});
test("budget methodology includes complete costs, reserve semantics and honest fare disclosure", () => {
  for (const key of [
    "Flight",
    "Accommodation",
    "Food",
    "Local transport",
    "Activities",
    "Nearby-airport transfer",
    "Baggage",
    "Safety buffer",
  ])
    assert.ok(budgetMethodology.some((c) => c.name === key));
  assert.ok(
    budgetMethodology[budgetMethodology.length - 1].detail.includes(
      "not expected spending",
    ),
  );
  assert.ok(fareDisclosure.includes("not guaranteed live inventory"));
});
test("SEO CTA and language switching use the normal product, with EN-only publication", () => {
  const href = new URL(seoSearchHref(request), siteUrl);
  assert.equal(href.pathname, "/plan/results");
  assert.equal(href.searchParams.get("origin"), "zurich");
  assert.equal(href.searchParams.get("budget"), "500");
  assert.equal(href.searchParams.get("adults"), "2");
  assert.equal(href.searchParams.has("ai"), false);
  assert.equal(translatedPath(page.path, "sq"), "/sq");
  assert.equal(translatedPath("/plan/results", "sq"), "/sq/plan/results");
  assert.equal(
    sanitizeAnalyticsEvent({
      url: siteUrl + page.path + "?budget=500&text=private",
    })?.url,
    siteUrl + page.path,
  );
  assert.equal(
    sanitizeAnalyticsEvent({ url: siteUrl + "/from/unlisted" }),
    null,
  );
});
test("SEO discovery without configuration makes zero provider/AI calls", async () => {
  let calls = 0;
  const data = await loadSeoSearch(request, {}, async () => {
    calls++;
    throw Error();
  });
  assert.equal(calls, 0);
  assert.equal(data.state, "configuration");
  assert.equal(landingModel(page, data, today, now).quality.indexable, false);
});
test("SEO discovery bounds the whole operation, aborts pending requests and never calls OpenAI", async () => {
  const urls: string[] = [];
  let signal: AbortSignal | null | undefined;
  const data = await loadSeoSearch(
    request,
    { TRAVELPAYOUTS_API_TOKEN: "synthetic-seo" },
    async (url, options) => {
      urls.push(new URL(url).hostname);
      signal = options.signal;
      return new Promise<Response>(() => {});
    },
    async () => true,
    10,
  );
  assert.equal(data.state, "timeout");
  assert.ok(signal?.aborted);
  assert.equal(urls.includes("api.openai.com"), false);
});
test("SEO provider rejection fails safely without AI, invented candidates or raw errors", async () => {
  const calls: string[] = [];
  const data = await loadSeoSearch(
    request,
    { TRAVELPAYOUTS_API_TOKEN: "synthetic-seo" },
    async (url) => {
      calls.push(new URL(url).hostname);
      return new Response(null, { status: 503 });
    },
  );
  assert.equal(data.state, "provider");
  assert.equal(landingModel(page, data, today, now).quality.indexable, false);
  assert.equal(calls.includes("api.openai.com"), false);
});
test("existing private planner and editorial route metadata stays explicitly noindex", () => {
  for (const file of [
    "src/app/[locale]/plan/page.tsx",
    "src/app/[locale]/plan/results/page.tsx",
    "src/app/[locale]/plan/trips/[id]/page.tsx",
    "src/app/[locale]/[document]/page.tsx",
  ]) {
    assert.ok(readFileSync(file, "utf8").includes("index: false"));
  }
});

// The /from/{origin}/to/{destination} family is cancelled (not approved);
// the URL rules stay tested because /costs/{city} may reuse them.
test("route URL rules stay enforced although the family is cancelled", () => {
  assert.equal(routePath("tirana", "milan"), "/from/tirana/to/milan");
  assert.equal(
    routePath("skopje", "rio-de-janeiro"),
    "/from/skopje/to/rio-de-janeiro",
  );
  for (const [o, d] of [
    ["tirana", "city:BCN"],
    ["tirana", "place:Q60"],
    ["tirana", "Milan"],
    ["tirana", "milan/"],
    ["TIA", "milan"],
    ["tirana", "milan?date=2026-11-07"],
    ["tirana", "tirana"],
  ])
    assert.throws(() => routePath(o, d), `${o} → ${d}`);
});
