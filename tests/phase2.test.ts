import { userInput as formatOnly } from "../src/domain/money/provenance";
import { completePlan, matchingFlight } from "../src/domain/flight-pricing";
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTravelDates, isCalendarDate } from "../src/domain/dates";
import {
  parseRequest,
  requestQuery,
  updateRequestDates,
} from "../src/domain/request";
import { defaultRequest } from "./fixtures/prishtina-request";
import { createTravelpayoutsDiscovery } from "./flight-provider-fixture";
import { createPexelsImages } from "../src/providers/server/pexels";
import { createFixtureTravelProviders as createTravelProviders } from "./provider-fixtures";
import { providerJson, type ProviderFetch } from "../src/providers/server/http";
import { getTripTemplates } from "../src/services/travel";
import { flightDestinations } from "../src/catalogue/flight-destinations";
import { shortlistFlights } from "../src/domain/discovery";
import { pricePlan } from "../src/domain/pricing";
import { curate } from "../src/domain/ranking";
import { demoProviders } from "../src/providers/demo";
import { locations } from "../src/catalogue/locations";
const origin = locations.find((o) => o.id === "prishtina")!;
const request = defaultRequest;
const secret = "test-private-provider-secret";
const row = {
  origin: "PRN",
  destination: "VIE",
  price: 98.12,
  departure_at: request.dates.startDate + "T10:00:00+02:00",
  return_at: request.dates.endDate + "T14:00:00+02:00",
  found_at: "2026-10-06T08:00:00Z",
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      date: "Tue, 06 Oct 2026 09:00:00 GMT",
    },
  });
const now = () => new Date("2026-10-06T09:00:00Z");
const goodFetch: ProviderFetch = async () =>
  response({ success: true, currency: "EUR", data: [row] });
async function fare() {
  const r = await createTravelpayoutsDiscovery(secret, goodFetch, now).discover(
    request,
    origin,
  );
  assert.equal(r.status, "available");
  return r.value.fares[0];
}

test("calendar presets cross weeks, months, leap days and years without timezone shifts", () => {
  assert.deepEqual(resolveTravelDates("weekend", "2026-12-31"), {
    startDate: "2027-01-02",
    endDate: "2027-01-04",
    flexibleDays: 0,
  });
  assert.equal(
    resolveTravelDates("weekend", "2026-10-10").startDate,
    "2026-10-10",
  );
  assert.equal(
    resolveTravelDates("weekend", "2026-10-11").startDate,
    "2026-10-17",
  );
  assert.equal(
    resolveTravelDates("next-weekend", "2026-10-06").startDate,
    "2026-10-17",
  );
  assert.equal(
    resolveTravelDates("month", "2026-12-31").startDate,
    "2027-01-01",
  );
  assert.equal(
    resolveTravelDates("weekend", "2028-02-26", 3, 3).endDate,
    "2028-02-29",
  );
  assert.equal(
    resolveTravelDates("summer", "2026-07-01").startDate,
    "2027-06-01",
  );
  assert.equal(isCalendarDate("2027-02-29"), false);
  assert.equal(isCalendarDate("2028-02-29"), true);
});
test("explicit date URLs take precedence, round trip and keep nights/flex consistent", () => {
  const r = parseRequest(
    {
      when: "summer",
      start: "2028-02-28",
      end: "2028-03-02",
      nights: "10",
      flexDays: "3",
    },
    locations,
    "2027-12-31",
  );
  assert.equal(r.nights, 3);
  assert.equal(r.flexible, true);
  assert.deepEqual(
    parseRequest(Object.fromEntries(new URLSearchParams(requestQuery(r)))),
    r,
  );
  const changed = updateRequestDates(r, { nights: 5 }, "2027-12-31");
  assert.equal(changed.dates.endDate, "2028-03-04");
  assert.equal(
    parseRequest({ when: "month" }, locations, "2027-12-31").dates.startDate,
    "2028-01-01",
  );
  assert.equal(
    parseRequest(
      { start: "2027-02-29", end: "2027-03-02" },
      locations,
      "2027-12-31",
    ).dates.startDate,
    "2028-01-01",
  );
});
test("one origin-wide request uses private header and persistent normalized cache input", async () => {
  let calls = 0;
  const fetcher: ProviderFetch = async (url, options) => {
    calls++;
    const u = new URL(url);
    assert.equal(u.pathname, "/aviasales/v3/prices_for_dates");
    assert.equal(u.searchParams.get("origin"), "PRN");
    assert.equal(u.searchParams.has("destination"), false);
    assert.equal(u.searchParams.get("one_way"), "false");
    assert.equal(u.searchParams.get("limit"), "100");
    assert.equal(url.includes(secret), false);
    assert.equal(new Headers(options.headers).get("X-Access-Token"), secret);
    assert.equal(options.cache, "no-store");
    assert.equal(options.next, undefined);
    return goodFetch(url, options);
  };
  const r = await createTravelpayoutsDiscovery(secret, fetcher, now).discover(
    request,
    origin,
  );
  assert.equal(calls, 1);
  assert.equal(r.status, "available");
  assert.equal(JSON.stringify(r).includes(secret), false);
});
test("cached fares normalize integer cents, return units and genuine observation timestamps, never live", async () => {
  const f = await fare();
  assert.equal(f.price.amount.cents, 9812);
  assert.equal(f.price.confidence, "recent");
  assert.equal(f.price.demo, false);
  assert.equal(f.scope.unit, "per-traveller");
  assert.equal(f.scope.journey, "return");
  assert.equal(f.price.observedAt, "2026-10-06T08:00:00.000Z");
  const r = await createTravelpayoutsDiscovery(
    secret,
    async () =>
      response({
        success: true,
        currency: "EUR",
        data: [{ ...row, found_at: undefined }],
      }),
    now,
  ).discover(request, origin);
  if (r.status === "unavailable") throw Error();
  assert.equal(r.value.fares[0].price.observedAt, null);
  const stale = await createTravelpayoutsDiscovery(
    secret,
    goodFetch,
    // Beyond the provider's 7-day retention.
    () => new Date("2026-10-14"),
  ).discover(request, origin);
  if (stale.status === "unavailable") throw Error();
  assert.equal(stale.value.fares[0].price.source.status, "stale");
});
test("malformed dates and unsupported origins never invent a fare", async () => {
  const invalid = await createTravelpayoutsDiscovery(
    secret,
    async () =>
      response({
        success: true,
        currency: "EUR",
        data: [{ ...row, price: "98" }],
      }),
    now,
  ).discover(request, origin);
  assert.equal(invalid.status, "unavailable");
  const dates = await createTravelpayoutsDiscovery(
    secret,
    async () =>
      response({
        success: true,
        currency: "EUR",
        data: [{ ...row, return_at: "2026-02-30" }],
      }),
    now,
  ).discover(request, origin);
  assert.deepEqual(dates, {
    status: "unavailable",
    reason: "malformed-response",
  });
  const unsupported = await createTravelpayoutsDiscovery(secret, async () => {
    throw Error("must not fetch");
  }).discover(request, { ...origin, iataCodes: [] });
  assert.equal(unsupported.status, "unavailable");
});
test("identity resolution deduplicates destinations without an airfare-first ten-city cutoff", async () => {
  const f = await fare();
  const fares = flightDestinations.flatMap((d) =>
    (d.iataCodes ?? []).map((code) => ({ ...f, destinationCode: code })),
  );
  fares.push({ ...f, destinationCode: "XXX" });
  const result = shortlistFlights(fares, flightDestinations, request);
  assert.equal(result.candidates.length, flightDestinations.length - 1);
  assert.equal(
    result.candidates.some((c) => c.destination.id === request.originId),
    false,
  );
  assert.equal(result.unknown, 1);
  assert.equal(
    new Set(result.candidates.map((c) => c.destination.id)).size,
    flightDestinations.length - 1,
  );
});
for (const [status, reason] of [
  [429, "rate-limit"],
  [401, "authentication"],
  [403, "authentication"],
  [500, "unavailable"],
] as const)
  test(`HTTP ${status} produces a safe ${reason} state`, async () => {
    const r = await providerJson("https://provider.example", {}, 10, async () =>
      response({ error: secret }, status),
    );
    assert.deepEqual(r, { ok: false, reason });
    assert.equal(JSON.stringify(r).includes(secret), false);
  });
test("timeouts, network and malformed JSON failures are bounded and safe", async () => {
  assert.deepEqual(
    await providerJson(
      "https://provider.example",
      {},
      10,
      async () => new Promise(() => {}),
      5,
    ),
    { ok: false, reason: "timeout" },
  );
  assert.deepEqual(
    await providerJson("https://provider.example", {}, 10, async () => {
      throw Error(secret);
    }),
    { ok: false, reason: "unavailable" },
  );
  assert.deepEqual(
    await providerJson(
      "https://provider.example",
      {},
      10,
      async () => new Response("not json"),
    ),
    { ok: false, reason: "malformed-response" },
  );
});
// Policy (2026-10-27): production has no demo-priced road trips or stays. A missing
// price source yields fewer trips, never a fixture price.
test("missing credentials yield no demo-priced trips and no image discovery", async () => {
  let imageCalls = 0;
  const providers = await createTravelProviders({}, async (url) => {
    assert.equal(new URL(url).hostname, "commons.wikimedia.org");
    imageCalls++;
    return response({ batchcomplete: true });
  });
  assert.equal(providers.discovery, undefined);
  const search = await getTripTemplates(request, providers);
  assert.equal(imageCalls, 0);
  assert.ok(search.templates.every((t) => t.transport.mode === "flight"));
  assert.ok(
    search.templates.every(
      (t) =>
        t.transport.mode === "flight" &&
        t.transport.flightPricing.kind === "unavailable" &&
        !t.stay.demo,
    ),
  );
});
test("provider failure never substitutes demo road trips", async () => {
  const providers = await createTravelProviders(
    { TRAVELPAYOUTS_API_TOKEN: secret },
    async () => response({ private: secret }, 429),
  );
  const search = await getTripTemplates(request, providers);
  assert.ok(search.templates.every((t) => t.transport.mode === "flight"));
  assert.ok(search.issues.some((i) => i.source.status === "unavailable"));
  assert.equal(JSON.stringify(search).includes(secret), false);
});
test("hybrid pricing preserves scoped flight amount, estimates the rest and keeps reserve separate", async () => {
  const providers = await createTravelProviders(
    { TRAVELPAYOUTS_API_TOKEN: secret },
    goodFetch,
  );
  const search = await getTripTemplates(request, providers);
  const base = search.templates.find((b) => b.id === "vienna")!;
  assert.ok(base);
  const p = pricePlan(base, request);
  assert.ok(completePlan(p));
  assert.equal(p.costs[0].amount.cents, 19624);
  assert.ok(
    p.costs.slice(1).every((c) => c.confidence === "estimate" && !c.demo),
  );
  const changed = pricePlan(
    base,
    {
      ...request,
      flexible: true,
      preferences: {
        ...request.preferences,
        nearbyAirports: true,
        luggage: true,
      },
    },
    "price-change",
  );
  assert.equal(changed.costs[0].amount.cents, p.costs[0].amount.cents);
  assert.equal(changed.costs[1].confidence, "estimate");
  assert.equal(
    p.budget.budgetNeeded.cents,
    p.budget.estimatedSpend.cents + p.safetyBuffer.cents,
  );
  assert.equal(
    p.budget.estimatedSpend.cents,
    p.costs.reduce((sum, c) => sum + c.amount.cents, 0),
  );
  const low = {
    ...request,
    budget: {
      ...request.budget,
      cents: Math.floor(p.budget.budgetNeeded.cents / 1.16),
    },
  };
  assert.equal(curate([pricePlan(base, low)], low).slightlyOver.length, 0);
  assert.equal(
    pricePlan(base, updateRequestDates(request, { nights: 3 }, "2026-10-06"))
      .pricingCompleteness,
    "flight-unpriced",
  );
  const fare = matchingFlight(base.transport)!;
  const partyFare = {
    ...fare,
    scope: { ...fare.scope, unit: "party" as const, party: request.party },
  };
  const party = {
    ...base,
    transport: {
      mode: "flight" as const,
      flightPricing: {
        kind: "priced" as const,
        quote: fare.price,
        fare: partyFare,
      },
    },
  };
  assert.equal(pricePlan(party, request).costs[0].amount.cents, 9812);
  assert.equal(
    pricePlan(party, { ...request, party: { adults: 1, children: 0 } })
      .pricingCompleteness,
    "flight-unpriced",
  );
});
const photo = {
  id: 123,
  width: 3000,
  height: 2000,
  photographer: "Example Photographer",
  photographer_url: "https://www.pexels.com/@example",
  url: "https://www.pexels.com/photo/example-123/",
  src: { original: "https://images.pexels.com/photos/123/example.jpeg" },
  alt: "A lake with mountains",
};
test("Pexels uses a specific cached query and preserves attribution without claiming verification", async () => {
  const d = flightDestinations.find((d) => d.id === "vienna")!;
  const images = createPexelsImages(secret, [d], async (url, options) => {
    assert.match(new URL(url).searchParams.get("query")!, /Vienna/);
    assert.equal(options.next?.revalidate, 86400);
    assert.equal(new Headers(options.headers).get("Authorization"), secret);
    return response({ photos: [photo] });
  });
  const img = await images.forDestination(d.id);
  assert.equal(img.sourceId, "123");
  assert.equal(img.source, "provider");
  assert.equal(img.verification, "unverified");
  assert.equal(img.authorUrl, photo.photographer_url);
  assert.equal(img.photoUrl, photo.url);
  assert.match(img.attribution, /Example Photographer/);
  assert.equal(JSON.stringify(img).includes(secret), false);
});
test("Pexels failure or unsafe image falls back; verified local images never query", async () => {
  const d = flightDestinations[0];
  for (const body of [
    { photos: [] },
    {
      photos: [
        { ...photo, src: { original: "https://evil.example/photos/123.jpg" } },
      ],
    },
    { error: secret },
  ]) {
    const img = await createPexelsImages(secret, [d], async () =>
      response(body),
    ).forDestination(d.id);
    assert.equal(img.src, d.image!.src);
    assert.equal(img.sourceStatus?.status, "fallback");
  }
  const verified = {
    ...d,
    image: { ...d.image!, verification: "verified" as const },
  };
  assert.deepEqual(
    await createPexelsImages(secret, [verified], async () => {
      throw Error("must not fetch");
    }).forDestination(d.id),
    verified.image,
  );
  const failed = await createPexelsImages(
    secret,
    [d],
    async () => new Promise(() => {}),
    5,
  ).forDestination(d.id);
  assert.deepEqual(failed.sourceStatus, {
    status: "fallback",
    reason: "timeout",
  });
});
test("a full search preserves flight discovery but makes zero Commons or Pexels calls", async () => {
  let flightCalls = 0,
    imageCalls = 0,
    active = 0,
    maximum = 0;
  const providers = await createTravelProviders(
    { TRAVELPAYOUTS_API_TOKEN: secret, PEXELS_API_KEY: secret },
    async (url) => {
      if (url.includes("travelpayouts")) {
        flightCalls++;
        return response({
          success: true,
          currency: "EUR",
          data: flightDestinations.map((d) => ({
            ...row,
            destination: d.iataCodes![0],
          })),
        });
      }
      imageCalls++;
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return response({ photos: [photo] });
    },
  );
  const search = await getTripTemplates(request, providers);
  assert.equal(flightCalls, 1);
  assert.equal(imageCalls, 0);
  assert.equal(maximum, 0);
  assert.equal(
    search.templates.filter((t) => matchingFlight(t.transport)).length,
    10,
  );
  assert.equal(JSON.stringify(search).includes(secret), false);
  // Existing demo providers still satisfy the same interface.
  assert.ok(demoProviders.transport);
});

test("stale discovery health survives service composition and one-way quotes cannot price a return trip", async () => {
  const f = await fare();
  f.price.source = { status: "stale", reason: "old-provider-observation" };
  const providers = await createTravelProviders(
    { TRAVELPAYOUTS_API_TOKEN: secret },
    goodFetch,
  );
  providers.discovery = {
    async discover() {
      return { status: "available", value: { fares: [f], diagnostics: [] } };
    },
  };
  const search = await getTripTemplates(request, providers);
  const base = search.templates.find((t) => t.id === "vienna")!;
  assert.equal(pricePlan(base, request).flightPricing?.kind, "unavailable");
  f.price.source = { status: "available" };
  f.scope.journey = "one-way";
  base.transport = {
    mode: "flight",
    flightPricing: { kind: "priced", quote: f.price, fare: f },
  };
  assert.equal(pricePlan(base, request).pricingCompleteness, "flight-unpriced");
});
test("response byte limits reject oversized JSON even without a content-length header", async () => {
  const result = await providerJson(
    "https://provider.example",
    {},
    10,
    async () => new Response(JSON.stringify({ value: "x".repeat(2_000_001) })),
  );
  assert.deepEqual(result, { ok: false, reason: "malformed-response" });
});

test("currency text is deterministic across server/browser locale-data versions", async () => {
  const { formatMoney } = await import("../src/i18n/config");
  assert.equal(
    formatMoney(formatOnly({ cents: 123456, currency: "EUR" }), "en"),
    "€1,234.56",
  );
  assert.equal(
    formatMoney(formatOnly({ cents: 123456, currency: "EUR" }), "sq"),
    "1\u00a0234,56\u00a0€",
  );
  assert.equal(
    formatMoney(formatOnly({ cents: 50000, currency: "EUR" }), "sq"),
    "500\u00a0€",
  );
  assert.equal(
    formatMoney(formatOnly({ cents: -123, currency: "EUR" }), "sq"),
    "-1,23\u00a0€",
  );
});

test("domestic Prishtina search skips flight discovery and offers no demo road trips", async () => {
  let flightCalls = 0;
  const providers = await createTravelProviders(
    { TRAVELPAYOUTS_API_TOKEN: secret },
    async (url) => {
      if (new URL(url).hostname === "api.travelpayouts.com") flightCalls++;
      return response({}, 429);
    },
  );
  const search = await getTripTemplates(
    { ...request, scope: "domestic" },
    providers,
  );
  assert.equal(flightCalls, 0);
  assert.equal(search.issues.length, 0);
  assert.ok(search.templates.every((t) => t.transport.mode !== "road"));
});

test("irrelevant flight destinations do not trigger discovery for style filters or road detail", async () => {
  let calls = 0;
  const providers = {
    ...demoProviders,
    discovery: {
      async discover() {
        calls++;
        return { status: "unavailable" as const, reason: "rate-limit" };
      },
    },
  };
  const filtered = await getTripTemplates(
    { ...request, styles: ["nature"] },
    providers,
  );
  assert.ok(filtered.templates.length);
  assert.equal(filtered.issues.length, 0);
  const detail = await getTripTemplates(request, providers, "rugova");
  assert.equal(detail.templates.length, 1);
  assert.equal(detail.issues.length, 0);
  assert.equal(calls, 0);
});

test("flight failures remain visible for relevant international and domestic flight destinations", async () => {
  let calls = 0;
  const providers = await createTravelProviders(
    { TRAVELPAYOUTS_API_TOKEN: secret },
    async (url) => {
      if (new URL(url).hostname === "api.travelpayouts.com") calls++;
      return response({}, 429);
    },
  );
  for (const r of [
    request,
    { ...request, originId: "zurich", scope: "domestic" as const },
  ]) {
    const search = await getTripTemplates(r, providers);
    assert.ok(
      search.issues.some(
        (i) =>
          i.destinationId === "flight-discovery" &&
          i.source.status === "unavailable" &&
          i.source.reason === "rate-limit",
      ),
    );
  }
  assert.equal(calls, 2);
});
