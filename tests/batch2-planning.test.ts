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
import { decodeLocation, readLocation } from "../src/domain/locations";
import { destinationAccess } from "./fixtures/archived-destination-data";
import { createTravelProviders } from "./fixtures/archived-destination-data";
import { getTripTemplates } from "../src/services/travel";

const today = "2026-10-23";
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

test("Tokyo and Kyoto planning retain canonical destinations and all traveller inputs", async (t) => {
  // Conversion provenance records execution time. Compare immutable access data
  // at one instant instead of treating a later conversion timestamp as mutation.
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  for (const [slug, subject, name] of [
    ["tokyo", "place:Q1490", "Tokyo"],
    ["kyoto", "place:Q34600", "Kyoto"],
  ]) {
    const before = structuredClone(destinationAccess.get(subject));
    const target = destinationGuideTarget(subject);
    assert.ok(target);
    assert.equal(target.id, subject);
    assert.equal(target.name, name);
    assert.equal(target.cityCode, undefined);
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
    assert.equal(decodeLocation(url.searchParams.get("toPlace")!)?.id, subject);
    const request = discoveryRequest(
      Object.fromEntries(url.searchParams),
      today,
    );
    assert.equal(request.destination?.id, subject);
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
      subject,
    );
    assert.deepEqual(destinationAccess.get(subject), before);
    const guide = await loadDestinationGuide(slug);
    assert.equal(guide?.target?.id, subject);
    assert.equal(guide?.result.status, "reviewed");
  }
});

test("canonical place snapshots cannot smuggle city or airport aliases", () => {
  const target = destinationGuideTarget("place:Q34600")!;
  for (const extra of [
    { cityCode: "OSA" },
    { airportIata: "KIX" },
    { iataCodes: ["KIX"] },
    { type: "airport" },
    { id: "place:Q0" },
    { id: "place:Q34600/extra" },
  ])
    assert.equal(readLocation({ ...target, ...extra }), undefined);
  assert.equal(destinationGuideTarget("place:Q999999999999"), undefined);
});

test("place-prefilled search dispatches only reviewed Tokyo and Kyoto flight groups", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    assert.fail("No real network requests"),
  );
  for (const [subject, group] of [
    ["place:Q1490", "TYO"],
    ["place:Q34600", "OSA"],
  ]) {
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
    const targets: string[] = [];
    providers.discovery = {
      async discover(r) {
        targets.push(r.destination?.cityCode ?? "BROAD");
        return {
          status: "available",
          value: { fares: [], diagnostics: [] },
        };
      },
    };
    const result = await getTripTemplates(request, providers);
    assert.deepEqual(
      targets,
      [group],
      "existing bounded, targeted provider plan",
    );
    assert.equal(
      result.templates.length,
      1,
      "empty fare data retains one planning destination",
    );
    assert.ok(result.templates.every((row) => row.id === subject));
    const access = providers.destinationAccess?.get(subject);
    assert.equal(access?.destination.id, subject);
    if (subject === "place:Q34600") {
      assert.equal(access?.destination.name.en, "Kyoto");
      assert.deepEqual(
        access?.gateways.map((g) => g.airportCode),
        ["KIX", "ITM"],
      );
    }
  }
});

test("unknown or unavailable canonical access cannot trigger a broad provider search", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    assert.fail("No real network requests"),
  );
  for (const unavailable of [false, true]) {
    const target = {
      ...destinationGuideTarget("place:Q34600")!,
      ...(unavailable ? {} : { id: "place:Q999999999999" }),
    };
    const request = discoveryRequest(
      { ...query, styles: "", airports: "0", toPlace: JSON.stringify(target) },
      today,
    );
    const lookup = unavailable
      ? t.mock.method(destinationAccess, "get", () => undefined)
      : undefined;
    try {
      const providers = await createTravelProviders(
        {},
        async () => assert.fail("No metadata lookup"),
        false,
        request,
      );
      providers.discovery = {
        async discover() {
          return assert.fail(
            "No provider dispatch for unresolved canonical access",
          );
        },
      };
      assert.equal(
        (await getTripTemplates(request, providers)).templates.length,
        0,
      );
    } finally {
      lookup?.mock.restore();
    }
  }
});
