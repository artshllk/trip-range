import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { renderInChild } from "./child-render";
import { sanitizeAnalyticsEvent } from "../src/domain/analytics";
import {
  readAffiliateEvent,
  readHandoffContext,
  flightConfidence,
  flightHandoff,
  readFlightHandoff,
  type FlightHandoff,
  type AffiliatePlacement,
} from "../src/domain/affiliate";
import {
  aviasalesSearchUrl,
  createAviasalesAffiliate,
  safePartnerUrl,
} from "../src/providers/server/aviasales-affiliate";
import { guardAffiliate } from "../src/providers/server/affiliate-cache";
import { handleFlightAffiliate } from "../src/services/affiliate-handoff";
import { createTravelProviders } from "./flight-provider-fixture";
import { getTripTemplates } from "../src/services/travel";
import { pricePlan } from "../src/domain/pricing";
import {
  defaultRequest,
  parseRequest,
  requestQuery,
} from "../src/domain/request";
import { locations } from "../src/catalogue/locations";
import type { AffiliateEnvironment } from "../src/providers/server/environment";
import type { ProviderFetch } from "../src/providers/server/http";
const today = () => "2026-10-06";
test("analytics strips budget, snapshots and free text from event URL metadata", () => {
  assert.deepEqual(
    sanitizeAnalyticsEvent({
      type: "event",
      url: "https://goeksplo.com/plan/results?budget=300&text=private#private",
    }),
    { type: "event", url: "https://goeksplo.com/plan/results" },
  );
});
test("embedded field editor renders one existing dialog, while standalone editor renders its own", () => {
  const output = renderInChild(
    `
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { SearchEditor } = require('./.test-build/src/components/travel/SearchEditor.js');
    const props = { title: 'From', closeLabel: 'Done', onClose() {}, children: React.createElement('input', { 'aria-label': 'City' }) };
    const embedded = renderToStaticMarkup(React.createElement('dialog', { open: true }, React.createElement(SearchEditor, { ...props, embedded: true })));
    const standalone = renderToStaticMarkup(React.createElement(SearchEditor, { ...props, embedded: false }));
    process.stdout.write(JSON.stringify({ embedded, standalone }));
  `,
    undefined,
  );
  const html = JSON.parse(output);
  assert.equal((html.embedded.match(/<dialog/g) ?? []).length, 1);
  assert.ok(html.embedded.includes("<section"));
  assert.ok(html.embedded.includes('aria-label="City"'));
  assert.equal((html.standalone.match(/<dialog/g) ?? []).length, 1);
});
// Synthetic values only. Tests never load environment files or real credentials.
const env: AffiliateEnvironment = {
  TRAVELPAYOUTS_API_TOKEN: randomBytes(24).toString("hex"),
  TRAVELPAYOUTS_PROJECT_ID: "987654321012",
  TRAVELPAYOUTS_MARKER: "987654321013",
};
const route: FlightHandoff = {
  originCode: "PRN",
  destinationCode: "VIE",
  departureDate: "2026-10-10",
  returnDate: "2026-10-12",
  party: { adults: 2, children: 0 },
};
const partnerUrl = "https://aviasales.tp.st/ExampleLink";
const success: ProviderFetch = async (_url, options) => {
  const body = JSON.parse(String(options.body));
  return Response.json({
    code: "success",
    status: 200,
    result: {
      trs: Number(env.TRAVELPAYOUTS_PROJECT_ID),
      marker: Number(env.TRAVELPAYOUTS_MARKER),
      links: [
        { url: body.links[0].url, code: "success", partner_url: partnerUrl },
      ],
    },
  });
};
test("documented Aviasales exact URL uses route, DDMM dates, adults and children without credentials", () => {
  assert.equal(
    aviasalesSearchUrl(route, today()),
    "https://www.aviasales.com/search/PRN1010VIE12102",
  );
  assert.equal(
    aviasalesSearchUrl(
      { ...route, party: { adults: 1, children: 2 } },
      today(),
    ),
    "https://www.aviasales.com/search/PRN1010VIE121012",
  );
  assert.equal(
    aviasalesSearchUrl(
      { ...route, departureDate: "2026-12-31", returnDate: "2027-01-02" },
      today(),
    ),
    "https://www.aviasales.com/search/PRN3112VIE02012",
  );
  for (const secret of Object.values(env))
    assert.ok(!aviasalesSearchUrl(route, today())!.includes(secret!));
});
test("unsupported codes, large parties, past or ambiguous distant years never silently change the handoff", () => {
  for (const invalid of [
    { ...route, originCode: "unknown" },
    { ...route, destinationCode: "PRN" },
    { ...route, party: { adults: 8, children: 6 } },
    { ...route, departureDate: "2025-10-10", returnDate: "2025-10-12" },
    { ...route, departureDate: "2028-10-10", returnDate: "2028-10-12" },
  ])
    assert.equal(aviasalesSearchUrl(invalid, today()), undefined);
});
for (const party of [
  { adults: 8, children: 1 },
  { adults: 3, children: 6 },
  { adults: 8, children: 2 },
  { adults: 4, children: 6 },
]) {
  test(`party boundary: ${party.adults} adults and ${party.children} children retain planning counts and the existing nine-person handoff limit`, () => {
    const request = { ...defaultRequest, party };
    const parsed = parseRequest(
      Object.fromEntries(new URLSearchParams(requestQuery(request))),
    );
    assert.deepEqual(parsed.party, party);
    const handoff = { ...route, party: parsed.party };
    if (party.adults + party.children === 9) {
      assert.deepEqual(readFlightHandoff(handoff)?.party, party);
      assert.equal(
        aviasalesSearchUrl(handoff, today()),
        `https://www.aviasales.com/search/PRN1010VIE1210${party.adults}${party.children}`,
      );
    } else {
      assert.equal(readFlightHandoff(handoff), undefined);
      assert.equal(aviasalesSearchUrl(handoff, today()), undefined);
    }
    assert.deepEqual(handoff.party, party);
  });
}
test("partner conversion uses one full URL, server header token, numeric project/marker and placement-only SubIDs", async () => {
  for (const placement of ["results", "trip"] as AffiliatePlacement[]) {
    let count = 0;
    const provider = createAviasalesAffiliate(
      env,
      async (url, options) => {
        count++;
        assert.equal(url, "https://api.travelpayouts.com/links/v1/create");
        assert.equal(options.method, "POST");
        assert.equal(options.cache, "no-store");
        assert.equal(options.redirect, "error");
        assert.ok(
          new Headers(options.headers).get("X-Access-Token") ===
            env.TRAVELPAYOUTS_API_TOKEN,
        );
        assert.ok(!url.includes(env.TRAVELPAYOUTS_API_TOKEN!));
        assert.ok(!String(options.body).includes(env.TRAVELPAYOUTS_API_TOKEN!));
        const body = JSON.parse(String(options.body));
        assert.ok(body.trs === Number(env.TRAVELPAYOUTS_PROJECT_ID));
        assert.ok(body.marker === Number(env.TRAVELPAYOUTS_MARKER));
        assert.equal(body.shorten, true);
        assert.deepEqual(body.links, [
          {
            url: aviasalesSearchUrl(route, today()),
            sub_id: `${placement}_flight`,
          },
        ]);
        return success(url, options);
      },
      today,
    );
    const result = await provider.createLink(route, placement);
    assert.equal(count, 1);
    assert.deepEqual(result, {
      status: "available",
      link: { provider: "aviasales", url: partnerUrl },
    });
    for (const secret of Object.values(env))
      assert.ok(!JSON.stringify(result).includes(secret!));
  }
});
for (const [status, reason] of [
  [401, "authentication"],
  [429, "rate-limit"],
  [500, "provider"],
  [503, "provider"],
] as const)
  test(`affiliate HTTP ${status} is a safe normalized failure`, async () => {
    const provider = createAviasalesAffiliate(
      env,
      async () => new Response("private upstream body", { status }),
      today,
    );
    assert.deepEqual(await provider.createLink(route, "trip"), {
      status: "unavailable",
      reason,
    });
  });
test("affiliate timeout bounds slow headers and body parsing without leaking exceptions", async () => {
  for (const fetcher of [
    async () => new Promise<Response>(() => {}),
    async () => new Response(new ReadableStream({ start() {} })),
  ]) {
    const provider = createAviasalesAffiliate(env, fetcher, today, 5);
    assert.deepEqual(await provider.createLink(route, "trip"), {
      status: "unavailable",
      reason: "timeout",
    });
  }
});
test("malformed, failed conversion, wrong destination, oversized and unsafe partner links are rejected", async () => {
  for (const body of [
    {},
    {
      code: "success",
      status: 200,
      result: { links: [{ code: "failed", partner_url: partnerUrl }] },
    },
    {
      code: "success",
      status: 200,
      result: {
        links: [
          {
            code: "success",
            url: "https://other.example",
            partner_url: partnerUrl,
          },
        ],
      },
    },
    "x".repeat(66000),
  ]) {
    const result = await createAviasalesAffiliate(
      env,
      async () => Response.json(body),
      today,
    ).createLink(route, "trip");
    assert.deepEqual(result, { status: "unavailable", reason: "malformed" });
  }
  for (const url of [
    "https://www.aviasales.com/search/PRN1010VIE12102",
    "https://evil.example/link",
    "javascript:alert(1)",
    "https://avs.io@evil.example/link",
    `https://avs.io/link?marker=${env.TRAVELPAYOUTS_MARKER}`,
  ])
    assert.equal(safePartnerUrl(url, env), false);
});
test("missing affiliate configuration makes no upstream call", async () => {
  for (const missing of Object.keys(env)) {
    const provider = createAviasalesAffiliate(
      { ...env, [missing]: undefined },
      async () => {
        throw Error("Must not call");
      },
      today,
    );
    assert.deepEqual(await provider.createLink(route, "trip"), {
      status: "unavailable",
      reason: "configuration",
    });
  }
});
test("click cache deduplicates concurrent conversions, caches failures and caps requests below API quota", async () => {
  let calls = 0,
    now = 0;
  const provider = guardAffiliate(
    {
      async createLink() {
        calls++;
        return {
          status: "available",
          link: { provider: "aviasales", url: partnerUrl },
        };
      },
    },
    () => now,
    2,
  );
  await Promise.all([
    provider.createLink(route, "trip"),
    provider.createLink(route, "trip"),
  ]);
  assert.equal(calls, 1);
  await provider.createLink(route, "results");
  assert.equal(calls, 2);
  assert.deepEqual(
    await provider.createLink({ ...route, destinationCode: "LON" }, "trip"),
    { status: "unavailable", reason: "rate-limit" },
  );
  now = 60001;
  await provider.createLink({ ...route, destinationCode: "LON" }, "trip");
  assert.equal(calls, 3);
  let failures = 0;
  const failing = guardAffiliate(
    {
      async createLink() {
        failures++;
        return { status: "unavailable", reason: "provider" };
      },
    },
    () => now,
  );
  await failing.createLink(route, "trip");
  await failing.createLink(route, "trip");
  assert.equal(failures, 1);
});
test("public affiliate endpoint emits only sanitized partner result and blocks invalid or cross-site payloads", async () => {
  const provider = createAviasalesAffiliate(env, success, today);
  const make = (body: unknown, origin = "http://localhost:3000") =>
    new Request("http://localhost:3000/api/affiliate/flights", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin },
      body: JSON.stringify(body),
    });
  const response = await handleFlightAffiliate(
    make({ route, placement: "trip" }),
    provider,
  );
  const result = await response.text();
  assert.equal(response.status, 200);
  for (const secret of Object.values(env)) assert.ok(!result.includes(secret!));
  assert.equal(response.headers.get("cache-control"), "no-store");
  for (const request of [
    make({ route, placement: "user_name_budget" }),
    make({ route, placement: "trip" }, "https://other.example"),
    make({ route: { ...route, originCode: "bad" }, placement: "trip" }),
    make("x".repeat(3000)),
  ])
    assert.equal((await handleFlightAffiliate(request, provider)).status, 400);
  const failed = await handleFlightAffiliate(
    make({ route, placement: "trip" }),
    {
      async createLink() {
        throw Error("private");
      },
    },
  );
  assert.deepEqual(await failed.json(), { status: "unavailable" });
});
test("the browser event endpoint accepts views and rejects legacy returns and forged clicks", () => {
  const view = {
    event: "cta_view",
    placement: "trip",
    originCode: "PRN",
    destinationCode: "VIE",
    state: "partial",
    fareAge: "unknown",
  };
  const count = {
    outcome: "view",
    originCode: "PRN",
    destinationCode: "VIE",
    fareAge: "unknown",
  };
  assert.deepEqual(readAffiliateEvent(view), count);
  assert.deepEqual(
    readAffiliateEvent({
      event: "cta_view",
      originCode: "PRN",
      destinationCode: "VIE",
      fareAge: "unknown",
    }),
    count,
  );
  for (const invalid of [
    { ...view, event: "return", away: "<2m" },
    { ...view, event: "return" },
    { ...view, event: "click" },
    { ...view, away: "<2m" },
    { ...view, visitorId: "example" },
  ])
    assert.equal(readAffiliateEvent(invalid), undefined);
});
test("click context is validated strictly", () => {
  assert.deepEqual(readHandoffContext({ state: "no_fare", fareAge: "old" }), {
    state: "no_fare",
    fareAge: "old",
  });
  assert.equal(
    readHandoffContext({ state: "booked", fareAge: "old" }),
    undefined,
  );
  assert.equal(
    readHandoffContext({ state: "priced", fareAge: "fresh", price: 1 }),
    undefined,
  );
});

for (const mode of ["exact", "flexible", "weekends", "reference"] as const)
  test(`${mode} handoff uses displayed trip dates and honest confidence`, async () => {
    const request = {
      ...parseRequest(
        mode === "weekends"
          ? { dateMode: "weekends", month: "2026-10" }
          : {
              start: "2026-10-10",
              end: "2026-10-12",
              flexDays: mode === "flexible" ? "3" : "0",
            },
        locations,
        today(),
      ),
      originId: "zurich",
    };
    const actual =
      mode === "exact"
        ? ["2026-10-10", "2026-10-12"]
        : mode === "weekends"
          ? ["2026-10-17", "2026-10-19"]
          : ["2026-10-12", "2026-10-14"];
    const providers = await createTravelProviders(
      { TRAVELPAYOUTS_API_TOKEN: "synthetic-discovery" },
      async (url) =>
        new URL(url).hostname === "api.travelpayouts.com"
          ? Response.json({
              success: true,
              currency: "EUR",
              data: [
                {
                  origin: "ZRH",
                  destination: "VIE",
                  price: 70,
                  found_at: new Date().toISOString(),
                  departure_at: actual[0],
                  return_at: actual[1],
                },
              ],
            })
          : Response.json({}),
    );
    const search = await getTripTemplates(request, providers);
    const plan = pricePlan(
      search.templates.find((p) => p.id === "vienna")!,
      request,
    );
    const handoff = flightHandoff(plan)!;
    assert.ok(handoff);
    assert.equal(
      handoff.departureDate,
      mode === "reference" ? "2026-10-10" : actual[0],
    );
    assert.equal(
      handoff.returnDate,
      mode === "reference" ? "2026-10-12" : actual[1],
    );
    assert.equal(
      flightConfidence(plan),
      mode === "reference" ? "unavailable" : "recent",
    );
    const before = JSON.stringify(plan);
    await createAviasalesAffiliate(
      env,
      async () => new Response(null, { status: 500 }),
      today,
    ).createLink(handoff, "trip");
    assert.equal(
      JSON.stringify(plan),
      before,
      "affiliate failure cannot remove or reprice a trip",
    );
  });
test("arbitrary selected destination stays usable as an unpriced idea after empty or failed discovery", async () => {
  const request = {
    ...defaultRequest,
    destination: {
      id: "city:FUK",
      type: "city" as const,
      name: "Fukuoka",
      countryCode: "JP",
      countryName: { en: "Japan", sq: "Japonia" },
      cityCode: "FUK",
      iataCodes: ["FUK"],
    },
  };
  for (const status of [200, 503]) {
    const providers = await createTravelProviders(
      { TRAVELPAYOUTS_API_TOKEN: "synthetic" },
      async () =>
        status === 200
          ? Response.json({ success: true, currency: "EUR", data: [] })
          : new Response(null, { status }),
      false,
      request,
    );
    const search = await getTripTemplates(request, providers);
    const plan = pricePlan(search.templates[0], request);
    assert.equal(plan.id, "city:FUK");
    assert.equal(flightConfidence(plan), "unavailable");
    assert.equal(plan.costs[0].confidence, "estimate");
    assert.ok(flightHandoff(plan));
  }
});
test("handoff diagnostics give failure reasons without a per-click itinerary or successful event", async () => {
  const make = (body: unknown) =>
    new Request("http://localhost:3000/api/affiliate/flights", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify(body),
    });
  const lines: { stream: string; line: string }[] = [];
  const saved = {
    error: console.error,
    warn: console.warn,
    info: console.info,
  };
  console.error = (line: string) => lines.push({ stream: "error", line });
  console.warn = (line: string) => lines.push({ stream: "warn", line });
  console.info = (line: string) => lines.push({ stream: "info", line });
  try {
    for (const reason of ["configuration", "malformed"] as const) {
      const response = await handleFlightAffiliate(
        make({ route, placement: "trip" }),
        {
          async createLink() {
            return { status: "unavailable", reason };
          },
        },
      );
      assert.equal(response.status, 503, "no unattributed link is returned");
    }
    const rejected = await handleFlightAffiliate(
      make({ route, placement: "trip", fareAge: "fresh" }),
      {
        async createLink() {
          throw Error("unavailable");
        },
      },
    );
    assert.equal(rejected.status, 503);
    const ok = await handleFlightAffiliate(
      make({
        route,
        placement: "trip",
        context: { state: "partial", fareAge: "old" },
      }),
      createAviasalesAffiliate(env, success, today),
    );
    assert.equal(ok.status, 200);
    assert.equal(
      (
        await handleFlightAffiliate(
          make({
            route,
            placement: "trip",
            context: { state: "booked", fareAge: "old" },
          }),
          createAviasalesAffiliate(env, success, today),
        )
      ).status,
      400,
    );
  } finally {
    Object.assign(console, saved);
  }
  const events = lines
    .filter((l) => l.line.includes('"affiliate-handoff"'))
    .map((l) => ({ stream: l.stream, ...JSON.parse(l.line) }));
  assert.deepEqual(
    events.map((e) => [e.stream, e.affiliateReason]),
    [
      ["error", "configuration"],
      ["error", "malformed"],
      ["warn", "provider"],
    ],
  );
  for (const e of events) {
    assert.deepEqual(Object.keys(e).sort(), [
      "affiliateReason",
      "component",
      "level",
      "operation",
      "status",
      "stream",
    ]);
  }
  assert(
    !lines.some(
      ({ line }) =>
        line.includes('"affiliate-link"') && line.includes('"success"'),
    ),
  );
});
