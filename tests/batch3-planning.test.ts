// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  destinationGuideTarget,
  loadDestinationGuide,
} from "./fixtures/archived-destination-data";
import {
  discoveryRequest,
  discoveryRequestQuery,
  planDestinationHref,
} from "../src/domain/destination-discovery";
import { decodeLocation } from "../src/domain/locations";
import { destinationAccess } from "./fixtures/archived-destination-data";
import { createTravelProviders } from "./fixtures/archived-destination-data";
import { getTripTemplates } from "../src/services/travel";

const today = "2026-10-24";
const query = {
  origin: "zurich",
  budget: "1600",
  currency: "CHF",
  adults: "2",
  children: "1",
  when: "custom",
  start: "2026-11-20",
  end: "2026-11-23",
  flexDays: "3",
  styles: "city,quiet",
  stay: "simple",
  airports: "1",
  luggage: "1",
  family: "1",
  toPlace: "previous destination",
  arrival: "JFK",
  arrivalFor: "place:Q60",
};

test("Batch 3 planning retains intended destinations and all traveller inputs", async () => {
  for (const [slug, subject, name, code] of [
    ["cape-town", "place:Q5465", "Cape Town", "CPT"],
    ["rio-de-janeiro", "place:Q8678", "Rio de Janeiro", "RIO"],
    ["sydney", "place:Q3130", "Sydney", "SYD"],
    ["dubai", "place:Q612", "Dubai", "DXB"],
  ]) {
    const before = structuredClone(destinationAccess.get(subject));
    const target = destinationGuideTarget(subject);
    assert.ok(target);
    assert.equal(target.id, `city:${code}`);
    assert.equal(target.name, name);
    assert.equal(target.cityCode, code);
    assert.equal(target.airportIata, undefined);
    assert.equal(target.iataCodes, undefined);
    const url = new URL(
      planDestinationHref(target, query),
      "https://example.test",
    );
    for (const [key, value] of Object.entries(query))
      if (!["toPlace", "arrival", "arrivalFor"].includes(key))
        assert.equal(url.searchParams.get(key), value, key);
    assert.equal(url.searchParams.has("arrival"), false);
    assert.equal(url.searchParams.has("arrivalFor"), false);
    assert.equal(
      decodeLocation(url.searchParams.get("toPlace")!)?.id,
      `city:${code}`,
    );
    const request = discoveryRequest(
      Object.fromEntries(url.searchParams),
      today,
    );
    assert.equal(request.destination?.id, `city:${code}`);
    assert.equal(request.destination?.name, name);
    assert.deepEqual(request.party, { adults: 2, children: 1 });
    assert.deepEqual(request.dates, {
      startDate: query.start,
      endDate: query.end,
      flexibleDays: 3,
    });
    assert.equal(request.budget.currency, "CHF");
    assert.equal(
      discoveryRequest(discoveryRequestQuery(request), today).destination?.id,
      `city:${code}`,
    );
    assert.deepEqual(destinationAccess.get(subject), before);
    const guide = await loadDestinationGuide(slug);
    assert.ok(guide);
    assert.equal(guide.card.subject, subject);
    assert.equal(guide.target?.id, `city:${code}`);
  }
});

test("Batch 3 city-prefilled search resolves canonical places and keeps each airport group bounded", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    assert.fail("No network requests"),
  );
  for (const [subject, code, airports] of [
    ["place:Q5465", "CPT", ["CPT"]],
    ["place:Q8678", "RIO", ["SDU", "GIG", "RRJ"]],
    ["place:Q3130", "SYD", ["WSI", "SYD"]],
    ["place:Q612", "DXB", ["DWC", "DXB"]],
  ] as const) {
    const target = destinationGuideTarget(subject)!;
    const url = new URL(
      planDestinationHref(target, { ...query, styles: "", airports: "0" }),
      "https://example.test",
    );
    const request = discoveryRequest(
      Object.fromEntries(url.searchParams),
      today,
    );
    const providers = await createTravelProviders(
      {},
      async () => assert.fail("No metadata lookup"),
      false,
      request,
    );
    const groups: string[] = [];
    providers.discovery = {
      async discover(input) {
        groups.push(input.destination?.cityCode ?? "BROAD");
        return { status: "available", value: { fares: [], diagnostics: [] } };
      },
    };
    const result = await getTripTemplates(request, providers);
    assert.deepEqual(groups, [code]);
    assert.equal(result.templates.length, 1);
    assert.equal(result.templates[0].id, subject);
    assert.deepEqual(
      providers.destinationAccess?.get(subject)?.directCity?.airportCodes,
      [...airports],
    );
    assert.equal(
      result.templates[0].transport.mode === "flight"
        ? result.templates[0].transport.flightPricing.kind
        : undefined,
      "unavailable",
      "Empty provider response does not invent a fare",
    );
  }
});
