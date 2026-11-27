import { collectCandidateObservation } from "./flight-provider-fixture";
import { test } from "node:test";
import { candidateCostFixtures } from "./cost-profile-fixtures";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import {
  seoCandidateRegistry,
  type SeoCandidateDefinition,
} from "../src/seo/candidates/registry";
import { candidateMarkets } from "../src/seo/candidates/markets";
import { validateCandidate } from "../src/seo/candidates/validation";
import {
  readCandidateEvidence,
  deriveResearchObservation,
  type CandidateObservation,
  evidenceSources,
} from "../src/seo/candidates/evidence";
import { evaluateCandidatePublicationReadiness } from "../src/seo/candidates/readiness";
import { seoLandingRegistry, approvedLanding } from "../src/seo/registry";
import { approvedLandingKeys } from "../src/seo/approved-keys";
import { landingId } from "../src/seo/identity";
import {
  seoSitemap,
  breadcrumbSchema,
  breadcrumbs,
} from "../src/seo/publication";
import { resolveSeoDates, seoDatePresentation } from "../src/seo/date-contract";
import {
  seoRequest,
  seoSearchHref,
  evaluateSeoTrips,
} from "../src/seo/summary";
import { defaultRequestFor, parseRequest } from "../src/domain/request";
import { referenceCalendarDate } from "../src/domain/dates";
import { locations } from "../src/catalogue/locations";
import { flightDestinations } from "../src/catalogue/flight-destinations";
import { matchingFlight, completePlan } from "../src/domain/flight-pricing";
import type { TripTemplate, FlightDiscoveryFare } from "../src/domain/types";
import { candidateOptions } from "../scripts/validate-seo-candidates";
import { createResearchNetwork } from "../scripts/research-markets";

const today = "2026-10-08",
  now = new Date("2026-10-08T12:00:00.000Z");
const london = seoCandidateRegistry.find(
  (p) => p.key.originId === "london" && p.type === "budget",
)!;
const evidence = readCandidateEvidence(
  JSON.parse(
    readFileSync("docs/seo/evidence/candidates/2026-10-08.json", "utf8"),
  ),
);
const first = evidence.observations.find((o) => o.origin === "london")!;
const reviewed: SeoCandidateDefinition = {
  ...london,
  reviews: { dateContract: "reviewed", costAssumptions: "reviewed" },
};
const reviewRegistry = seoCandidateRegistry.map((p) =>
  p.id === reviewed.id ? reviewed : p,
);
function observation(
  day: string,
  changes: Partial<CandidateObservation> = {},
): CandidateObservation {
  return {
    ...first,
    observedAt: `${day}T12:00:00.000Z`,
    source: "candidate-live",
    sourceFile: null,
    destinationCoverage: {
      completeDestinationIds: candidateCostFixtures.map((p) => p.destinationId),
      fitDestinationIds: candidateCostFixtures.map((p) => p.destinationId),
      reviewedCosts: candidateCostFixtures.map((p) => ({
        destinationId: p.destinationId,
        profileId: p.id,
        revision: p.revision,
      })),
    },
    ...changes,
  };
}
const good = [
  observation("2026-10-08"),
  observation("2026-10-11"),
  observation("2026-10-14"),
];
function readiness(
  rows: CandidateObservation[],
  day = "2026-10-14",
  page = reviewed,
) {
  return evaluateCandidatePublicationReadiness(
    page,
    reviewRegistry,
    { version: 2, observations: rows },
    day,
    candidateCostFixtures,
  );
}
test("candidate registry has twelve valid English drafts with four exact native budgets and normalized identities", () => {
  assert.equal(seoCandidateRegistry.length, 12);
  assert.deepEqual(
    candidateMarkets.map((m) => [m.slug, m.origin.id, m.budget]),
    [
      ["london", "city:LON", { cents: 50000, currency: "GBP" }],
      ["manchester", "city:MAN", { cents: 50000, currency: "GBP" }],
      ["dublin", "city:DUB", { cents: 50000, currency: "EUR" }],
      ["chicago", "city:CHI", { cents: 120000, currency: "USD" }],
    ],
  );
  for (const page of seoCandidateRegistry) {
    assert.deepEqual(
      validateCandidate(page, seoCandidateRegistry),
      [],
      page.id,
    );
    assert.equal(page.reviews.costAssumptions, "pending");
    assert.equal(page.reviews.dateContract, "pending");
    assert.equal("approved" in page, false);
    assert.equal("indexable" in page, false);
  }
});
test("editorial lint rejects duplicate titles/H1/intents, currencies, authority, identities, copy and draft relationships", () => {
  const invalid = [
    { title: seoCandidateRegistry[0].title },
    { h1: seoCandidateRegistry[0].h1 },
    { planningCurrency: "EUR" },
    { budget: { cents: 70000, currency: "GBP" } },
    { approved: true },
    { locale: "sq" },
    { path: "/from/london/weekend-trips-under-700" },
    { origin: { ...london.origin, id: "london" } },
    { origin: { ...london.origin, countryCode: "IE" } },
    { questions: [] },
    { sections: ["results"] },
    { related: [] },
    { parent: undefined },
    { intro: "For this weekend, get guaranteed availability." },
    { dateContract: { kind: "fixed-weekend" } },
    { intro: london.keywords.primary.repeat(8) },
  ];
  for (const change of invalid)
    assert.ok(
      validateCandidate(
        { ...london, ...change } as SeoCandidateDefinition,
        seoCandidateRegistry,
      ).length,
      JSON.stringify(change),
    );
  assert.ok(
    validateCandidate(london, [...seoCandidateRegistry, london]).some((r) =>
      r.includes("duplicate"),
    ),
  );
});
test("Zurich date contract, exact weekend prefill, approved identities and weak sitemap remain unchanged", () => {
  assert.equal(seoLandingRegistry.length, 4);
  assert.deepEqual(approvedLandingKeys.map(landingId), [
    "en-zurich-origin",
    "en-zurich-weekend",
    "en-zurich-budget-eur-50000",
    "en-tirana-origin",
  ]);
  for (const page of seoLandingRegistry) {
    assert.deepEqual(page.dateContract, { kind: "fixed-weekend" });
    assert.deepEqual(
      seoRequest(page, today).dates,
      defaultRequestFor(today).dates,
    );
    assert.equal(seoRequest(page, today).budget.currency, "EUR");
    const copy = seoDatePresentation(
      page.dateContract,
      seoRequest(page, today).dates,
    );
    assert.equal(copy.summary, "2026-10-10 → 2026-10-12");
    assert.match(copy.description, /Exact dates stay exact/);
  }
  assert.equal(seoSitemap([]).length, 1);
});
test("month-weekends chooses the next full month deterministically including December rollover", () => {
  for (const [date, month, start, end] of [
    [today, "2026-11", "2026-11-07", "2026-11-09"],
    ["2026-12-31", "2027-01", "2027-01-02", "2027-01-04"],
    ["2026-10-31", "2026-11", "2026-11-07", "2026-11-09"],
  ]) {
    assert.deepEqual(resolveSeoDates(london.dateContract, date), {
      mode: "weekends",
      month,
      startDate: start,
      endDate: end,
      flexibleDays: 0,
    });
  }
  assert.throws(() => resolveSeoDates(london.dateContract, "2026-02-30"));
  assert.equal(
    referenceCalendarDate(new Date("2026-12-31T23:30:00Z")),
    "2027-01-01",
  );
});
test("monthly presentation names the month and discloses different actual weekends, with no fixed-weekend claim", () => {
  const copy = seoDatePresentation(
    london.dateContract,
    seoRequest(london, today).dates,
  );
  assert.match(copy.summary, /November 2026/);
  assert.match(copy.description, /Saturday–Monday/);
  assert.match(copy.description, /different weekends/);
  assert.match(copy.evidenceNote, /unpriced ideas do not count/);
  assert.doesNotMatch(
    JSON.stringify(copy),
    /Exact dates stay exact|The displayed example is|For this weekend/,
  );
  assert.throws(() =>
    seoDatePresentation(london.dateContract, defaultRequestFor(today).dates),
  );
});
test("every monthly CTA round-trips normal product date mode, origin, native whole-party budget and preferences", () => {
  for (const page of seoCandidateRegistry) {
    const request = seoRequest(page, today),
      url = new URL(seoSearchHref(request), "https://goeksplo.com");
    assert.equal(url.pathname, "/plan/results");
    assert.equal(url.searchParams.get("dateMode"), "weekends");
    assert.equal(url.searchParams.get("month"), "2026-11");
    const parsed = parseRequest(
      Object.fromEntries(url.searchParams),
      locations,
      today,
    );
    assert.deepEqual(parsed.dates, request.dates);
    assert.deepEqual(parsed.budget, request.budget);
    assert.deepEqual(parsed.party, { adults: 2, children: 0 });
    assert.equal(parsed.origin?.id, page.origin.id);
    assert.equal(parsed.preferences.nearbyAirports, false);
    assert.equal(parsed.preferences.luggage, false);
  }
});
function templates(): TripTemplate[] {
  const request = seoRequest(london, today);
  return flightDestinations.slice(0, 4).map((destination, i) => {
    const quote = {
      amount: { cents: 1000, currency: "GBP" as const },
      confidence: "recent" as const,
      source: { status: "available" as const },
      providerId: "travelpayouts-aviasales-data",
      observedAt: now.toISOString(),
      demo: false,
    };
    const dates = [
      ["2026-11-07", "2026-11-09"],
      ["2026-11-14", "2026-11-16"],
      ["2026-11-28", "2026-11-30"],
      ["2026-11-13", "2026-11-15"],
    ][i];
    const fare: FlightDiscoveryFare = {
      originCode: "LON",
      destinationCode: destination.iataCodes![0],
      price: quote,
      scope: {
        unit: "per-traveller",
        journey: "return",
        dates: { startDate: dates[0], endDate: dates[1], flexibleDays: 0 },
        fees: "provider-unspecified",
      },
      retrievedAt: now.toISOString(),
    };
    return {
      id: destination.id,
      origin: request.origin!,
      destination,
      transport: {
        mode: "flight",
        flightPricing: { kind: "priced", quote, fare },
      },
      stay: {
        ...quote,
        amount: { cents: 8000, currency: "GBP" },
        confidence: "estimate",
        providerId: "goeksplo-stay-estimate",
        observedAt: null,
      },
      itinerary: [],
    };
  });
}
test("normal engine keeps different actual weekends, deduplicates destinations and excludes reference/unpriced ideas from fits", () => {
  const input = templates();
  const result = evaluateSeoTrips(
    { templates: [...input, input[0]], issues: [] },
    seoRequest(london, today),
    now.toISOString(),
  );
  assert.equal(result.summary.destinationsChecked, 4);
  assert.equal(result.summary.providerSupportedCount, 2);
  assert.equal(result.summary.completeCalculationCount, 2);
  assert.equal(result.summary.providerSupportedFitsCount, 2);
  assert.equal(result.summary.referenceFareCount, 1);
  assert.equal(result.summary.unpricedFlightCount, 2);
  assert.equal(result.cards.length, 3);
  assert.equal(new Set(result.cards.map((p) => p.id)).size, 3);
  assert.equal(
    new Set(
      result.cards.filter(completePlan).map((p) => p.request.dates.startDate),
    ).size,
    2,
  );
  for (const card of result.cards.filter(completePlan)) {
    assert.deepEqual(card.request.dates, matchingFlight(card)!.scope.dates);
    assert.equal(card.requestedDates?.month, "2026-11");
  }
});
test("research import reproduces exactly October 8 provenance and safe native metrics without inventing days", () => {
  assert.equal(evidence.observations.length, 4);
  assert.deepEqual(
    [...new Set(evidence.observations.map((o) => o.observedAt.slice(0, 10)))],
    [today],
  );
  for (const source of evidenceSources) {
    const rows = readFileSync(`docs/seo/evidence/${source}`, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    for (const row of rows.filter(
      (r) =>
        r.type === "sample" &&
        r.scenario === "any-sat-mon" &&
        candidateMarkets.some((m) => m.slug === r.origin),
    ))
      assert.deepEqual(
        deriveResearchObservation(row, source),
        evidence.observations.find((o) => o.origin === row.origin),
      );
  }
  assert.doesNotMatch(
    JSON.stringify(evidence),
    /token|headers|https?:|marker|affiliate/i,
  );
});
test("strict evidence boundary rejects wrong currency, extra fields, bad counts, malformed date and false provenance", () => {
  for (const change of [
    { currency: "USD" },
    { token: "must-not-store" },
    { budgetFits: 99 },
    { matchingFareCount: -1 },
    { observedAt: "2026-02-30T12:00:00.000Z" },
    { sourceFile: "private.jsonl" },
    { observedAt: "2026-10-09T12:00:00.000Z" },
    { exampleMonth: "2026-13" },
  ]) {
    assert.throws(() =>
      readCandidateEvidence({
        version: 2,
        observations: [{ ...first, ...change }],
      }),
    );
  }
  assert.throws(() => readCandidateEvidence({ version: 3, observations: [] }));
});
test("identical evidence deduplicates but conflicting snapshots with the same origin/time are rejected", () => {
  assert.equal(
    readCandidateEvidence({ version: 2, observations: [first, first] })
      .observations.length,
    1,
  );
  assert.throws(() =>
    readCandidateEvidence({
      version: 2,
      observations: [first, { ...first, budgetFits: 2 }],
    }),
  );
});
test("one day and three same-day snapshots cannot satisfy longitudinal evidence", () => {
  for (const rows of [
    [first],
    [
      first,
      observation(today, { observedAt: "2026-10-08T13:00:00.000Z" }),
      observation(today, { observedAt: "2026-10-08T14:00:00.000Z" }),
    ],
  ]) {
    const result = readiness(rows, today);
    assert.equal(result.status, "not-ready");
    assert.equal(result.observationDays.length, 1);
    assert.equal(result.spanDays, 0);
  }
});
test("three days over only two days are insufficient", () => {
  const result = readiness(
    [observation(today), observation("2026-10-09"), observation("2026-10-10")],
    "2026-10-10",
  );
  assert.equal(result.observationDays.length, 3);
  assert.equal(result.status, "not-ready");
  assert.ok(result.blockers.includes("observation span below six days"));
});
test("every reviewed observation must sustain three complete provider destinations and two budget fits", () => {
  for (const changes of [
    { completeProviderDestinations: 2, budgetFits: 2, unpricedCount: 8 },
    { budgetFits: 1 },
  ]) {
    assert.equal(
      readiness([
        good[0],
        {
          ...good[1],
          ...changes,
          destinationCoverage: {
            ...good[1].destinationCoverage!,
            completeDestinationIds:
              good[1].destinationCoverage!.completeDestinationIds.slice(
                0,
                changes.completeProviderDestinations ?? 4,
              ),
            fitDestinationIds:
              good[1].destinationCoverage!.fitDestinationIds.slice(
                0,
                changes.budgetFits,
              ),
            reviewedCosts: good[1].destinationCoverage!.reviewedCosts.slice(
              0,
              changes.completeProviderDestinations ?? 4,
            ),
          },
        },
        good[2],
      ]).status,
      "not-ready",
    );
  }
  const hub = { ...seoCandidateRegistry[0], reviews: reviewed.reviews };
  const reg = seoCandidateRegistry.map((p) => (p.id === hub.id ? hub : p));
  assert.equal(
    evaluateCandidatePublicationReadiness(
      hub,
      reg,
      {
        version: 2,
        observations: good.map((o) => ({
          ...o,
          budgetFits: 0,
          destinationCoverage: {
            ...o.destinationCoverage!,
            fitDestinationIds: [],
          },
        })),
      },
      "2026-10-14",
      candidateCostFixtures,
    ).status,
    "eligible-for-review",
  );
});
test("adequate repeated evidence plus explicit editorial/date/cost reviews yields eligibility only", () => {
  const before = JSON.stringify({ seoLandingRegistry, approvedLandingKeys });
  const result = readiness(good);
  assert.equal(result.status, "eligible-for-review");
  assert.equal(result.spanDays, 6);
  assert.deepEqual(result.blockers, []);
  assert.equal(
    JSON.stringify({ seoLandingRegistry, approvedLandingKeys }),
    before,
  );
  assert.equal(approvedLanding(london.path), undefined);
  assert.equal(seoSitemap([]).length, 1);
  assert.equal(readiness(good, "2026-10-14", london).status, "not-ready");
});
test("later provider failures and same-day failures block otherwise sufficient histories", () => {
  for (const status of [
    "provider",
    "configuration",
    "rate-limit",
    "timeout",
    "metadata-limited",
  ] as const) {
    assert.equal(
      readiness(
        [...good, observation("2026-10-15", { providerStatus: status })],
        "2026-10-15",
      ).status,
      "not-ready",
    );
    assert.equal(
      readiness([
        ...good,
        observation("2026-10-14", {
          observedAt: "2026-10-14T13:00:00.000Z",
          providerStatus: status,
        }),
      ]).status,
      "not-ready",
    );
  }
});
test("readiness fails closed on future, stale, wrong-currency or different-month evidence", () => {
  assert.equal(
    readiness([...good, observation("2026-10-15")]).status,
    "not-ready",
  );
  assert.equal(readiness(good, "2026-10-17").status, "not-ready");
  assert.equal(
    readiness(good.map((o) => ({ ...o, currency: "EUR" }))).status,
    "not-ready",
  );
  assert.equal(readiness(good, "2026-11-01").observationDays.length, 0);
});
test("daily collection can satisfy the six-day span and reviews every snapshot on the latest seven days", () => {
  const rows = Array.from({ length: 7 }, (_, i) =>
    observation(`2026-10-${String(8 + i).padStart(2, "0")}`),
  );
  assert.equal(readiness(rows).status, "eligible-for-review");
  assert.equal(
    readiness(
      rows.map((r, i) => (i === 2 ? { ...r, providerStatus: "provider" } : r)),
    ).status,
    "not-ready",
  );
});
test("offline command is default; live cannot broaden origins, pass secrets or request arbitrary URLs", () => {
  assert.deepEqual(candidateOptions([]), {
    live: false,
    importResearch: false,
  });
  assert.equal(candidateOptions(["--live"]).live, true);
  for (const args of [
    ["--origins=amsterdam"],
    ["--token=secret"],
    ["--url=example"],
    ["--live", "--import-phase7b2"],
    ["--live", "--live"],
  ])
    assert.throws(() => candidateOptions(args));
});
test("live collector makes one monthly request per origin and reuses it without AI, imagery or affiliate requests", async () => {
  const urls: URL[] = [];
  const network = createResearchNetwork(
    async (url) => {
      const u = new URL(url);
      urls.push(u);
      assert.equal(u.hostname, "api.travelpayouts.com");
      const origin = u.searchParams.get("origin")!;
      return Response.json({
        success: true,
        currency: u.searchParams.get("currency"),
        data: ["VIE", "ROM", "BER"].map((destination, i) => ({
          origin,
          destination,
          price: 10,
          departure_at: ["2026-11-07", "2026-11-14", "2026-11-21"][i],
          return_at: ["2026-11-09", "2026-11-16", "2026-11-23"][i],
          found_at: now.toISOString(),
        })),
      });
    },
    0,
    { fares: 4, metadata: 40 },
  );
  for (const market of candidateMarkets) {
    const row = await collectCandidateObservation(
      market.slug,
      "synthetic-candidate-test",
      network,
      now,
    );
    assert.equal(row.providerStatus, "available");
    assert.equal(row.completeProviderDestinations, 3);
    assert.ok(row.budgetFits >= 2);
    assert.equal(
      readCandidateEvidence({ version: 2, observations: [row] }).observations
        .length,
      1,
    );
  }
  assert.equal(network.counts.fares, 4);
  assert.equal(network.counts.metadata, 0);
  for (const url of urls) {
    assert.equal(url.searchParams.get("departure_at"), "2026-11");
    assert.equal(url.searchParams.has("return_at"), false);
  }
  await collectCandidateObservation(
    "london",
    "synthetic-candidate-test",
    network,
    now,
  );
  assert.equal(network.counts.fares, 4);
  assert.ok(network.counts.cacheHits >= 1);
});
test("collector records missing config, rate limits and timeout safely with bounded network", async () => {
  let calls = 0;
  const network = createResearchNetwork(
    async () => {
      calls++;
      return new Response("{}", { status: 429 });
    },
    0,
    { fares: 4, metadata: 40 },
  );
  assert.equal(
    (await collectCandidateObservation("london", undefined, network, now))
      .providerStatus,
    "configuration",
  );
  assert.equal(calls, 0);
  assert.equal(
    (await collectCandidateObservation("london", "synthetic", network, now))
      .providerStatus,
    "rate-limit",
  );
  await collectCandidateObservation("dublin", "synthetic", network, now);
  assert.equal(calls, 1);
  let signal: AbortSignal | null | undefined;
  const hanging = createResearchNetwork(
    async (_url, options) => {
      signal = options.signal;
      return new Promise<Response>(() => {});
    },
    0,
    { fares: 4, metadata: 40 },
  );
  assert.equal(
    (await collectCandidateObservation("london", "synthetic", hanging, now, 10))
      .providerStatus,
    "timeout",
  );
  assert.equal(signal?.aborted, true);
});
test("candidate network caps physical fare/metadata calls and rejects unrelated services", async () => {
  let calls = 0;
  const network = createResearchNetwork(
    async () => {
      calls++;
      return Response.json({});
    },
    0,
    { fares: 1, metadata: 1 },
  );
  await network.fetch(
    "https://api.travelpayouts.com/aviasales/v3/prices_for_dates?origin=LON",
    {},
  );
  assert.equal(
    (
      await network.fetch(
        "https://api.travelpayouts.com/aviasales/v3/prices_for_dates?origin=MAN",
        {},
      )
    ).status,
    503,
  );
  await network.fetch(
    "https://autocomplete.travelpayouts.com/places2?term=VIE",
    {},
  );
  assert.equal(
    (
      await network.fetch(
        "https://autocomplete.travelpayouts.com/places2?term=BER",
        {},
      )
    ).status,
    503,
  );
  assert.equal(calls, 2);
  assert.equal(network.counts.metadataLimitReached, true);
  for (const url of [
    "https://api.openai.com/v1/responses",
    "https://commons.wikimedia.org/w/api.php",
    "https://api.travelpayouts.com/links/v1/create",
  ])
    await assert.rejects(() => network.fetch(url, {}));
});
test("candidate definitions cannot be reached through the application's transitive import graph", () => {
  const visited = new Set<string>();
  function visit(file: string) {
    if (visited.has(file)) return;
    visited.add(file);
    assert.ok(!file.includes("/seo/candidates/"), file);
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    function dependency(node: ts.Node) {
      const specifier =
        ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
          ? node.moduleSpecifier
          : ts.isCallExpression(node) &&
              (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                node.expression.getText(source) === "require")
            ? node.arguments[0]
            : undefined;
      if (specifier && ts.isStringLiteral(specifier)) {
        const name = specifier.text;
        const base = name.startsWith("@/")
          ? resolve("src", name.slice(2))
          : name.startsWith(".")
            ? resolve(dirname(file), name)
            : undefined;
        if (base) {
          const target = [
            base,
            base + ".ts",
            base + ".tsx",
            base + "/index.ts",
            base + "/index.tsx",
          ].find((p) => existsSync(p) && /\.tsx?$/.test(p));
          if (target) visit(target);
        }
      }
      ts.forEachChild(node, dependency);
    }
    dependency(source);
  }
  function routes(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) routes(path);
      else if (/\.tsx?$/.test(path)) visit(path);
    }
  }
  routes("src/app");
  assert.ok(visited.size > 50);
});
test("candidate paths/IDs stay unavailable and absent from approved schema; date contract cannot change breadcrumbs", () => {
  for (const page of seoCandidateRegistry) {
    assert.equal(approvedLanding(page.path), undefined);
    assert.equal(
      approvedLandingKeys.some((key) => landingId(key) === page.id),
      false,
    );
    assert.equal(
      seoSitemap([]).some((url) => url.url.endsWith(page.path)),
      false,
    );
  }
  for (const page of seoLandingRegistry) {
    const monthly = { ...page, dateContract: london.dateContract };
    assert.deepEqual(breadcrumbSchema(monthly), breadcrumbSchema(page));
    assert.deepEqual(
      breadcrumbSchema(page).itemListElement.map((e) => e.item),
      breadcrumbs(page).map((b) => b.url),
    );
    assert.doesNotMatch(
      JSON.stringify(breadcrumbSchema(page)),
      /Offer|Product|Review|aggregateRating|availability/i,
    );
  }
});
