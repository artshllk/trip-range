import { matchingFlight } from "../src/domain/flight-pricing";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createLocationSearch,
  normalizeLocation,
} from "../src/providers/server/location-search";
import { readLocation, matchesDestination } from "../src/domain/locations";
import { parseRequest, requestQuery } from "../src/domain/request";
import { defaultRequest } from "./fixtures/prishtina-request";
import { weekendsInMonth } from "../src/domain/dates";
import { fareDateMatch } from "../src/domain/discovery";
import { createTravelProviders } from "./flight-provider-fixture";
import { getTripTemplates } from "../src/services/travel";
import { pricePlan } from "../src/domain/pricing";
import { locations } from "../src/catalogue/locations";
import type { TripRequest } from "../src/domain/types";
const city = {
  type: "city",
  code: "LON",
  name: "London",
  country_code: "GB",
  country_name: "United Kingdom",
  coordinates: { lat: 51.5, lon: -0.1 },
};
const airport = {
  ...city,
  type: "airport",
  code: "LHR",
  city_code: "LON",
  name: "London Heathrow Airport",
};
const london = normalizeLocation(city)!;
const heathrow = normalizeLocation(airport)!;
const fixtureFetch = async (url: string) =>
  new URL(url).hostname === "api.travelpayouts.com"
    ? Response.json({
        success: true,
        currency: "EUR",
        data: [
          {
            origin: "LHR",
            destination: "VIE",
            price: 70,
            found_at: new Date().toISOString(),
            departure_at: "2026-10-17",
            return_at: "2026-10-19",
          },
        ],
      })
    : Response.json({ batchcomplete: true });
test("global city and airport normalization retain explicit identity, city code, country and coordinates", () => {
  assert.equal(london.id, "city:LON");
  assert.equal(london.cityCode, "LON");
  assert.deepEqual(london.iataCodes, ["LON"]);
  assert.equal(london.airportIata, undefined);
  assert.equal(heathrow.id, "airport:LHR");
  assert.equal(heathrow.airportIata, "LHR");
  assert.equal(heathrow.cityCode, "LON");
  assert.deepEqual(heathrow.coordinates, { latitude: 51.5, longitude: -0.1 });
  const country = normalizeLocation({
    type: "country",
    code: "GB",
    name: "United Kingdom",
    country_code: "GB",
  });
  assert.equal(country?.type, "country");
  assert.equal(country?.iataCodes, undefined);
  assert.equal(
    normalizeLocation({ ...city, name: "<script>bad</script>" }),
    undefined,
  );
  assert.equal(readLocation({ ...london, id: "https://evil" }), undefined);
  assert.equal(
    readLocation({ ...london, id: undefined, cityCode: undefined }),
    undefined,
  );
  assert.equal(readLocation({ ...london, type: "airport" }), undefined);
});
test("ZRH and Zurich remain explicit airport and city suggestions, without silently choosing an airport", async () => {
  const provider = createLocationSearch(async () =>
    Response.json([
      {
        ...city,
        code: "ZRH",
        name: "Zurich",
        country_code: "CH",
        country_name: "Switzerland",
      },
      {
        ...airport,
        code: "ZRH",
        city_code: "ZRH",
        name: "Zurich Airport",
        country_code: "CH",
        country_name: "Switzerland",
      },
    ]),
  );
  for (const query of ["ZRH", "Zurich"]) {
    const found = await provider.search(query);
    assert.ok(found.locations.some((l) => l.id === "zurich"));
    assert.ok(found.locations.some((l) => l.id === "airport:ZRH"));
    assert.equal(found.status, "available");
  }
});
test("autocomplete bounds queries and suggestions; unknown text and failures remain safe", async () => {
  let calls = 0;
  const provider = createLocationSearch(async () => {
    calls++;
    return Response.json(
      Array.from({ length: 50 }, (_, i) => ({
        ...city,
        code: `A${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`,
      })),
    );
  });
  assert.equal((await provider.search("x")).locations.length, 0);
  assert.equal((await provider.search("x".repeat(81))).locations.length, 0);
  assert.equal(calls, 0);
  assert.equal((await provider.search("lon")).locations.length, 8);
  assert.deepEqual(
    await createLocationSearch(async () => Response.json([])).search(
      "zzzznothing",
    ),
    { locations: [], status: "available" },
  );
  const failure = await createLocationSearch(async () => {
    throw Error("private");
  }).search("Zurich");
  assert.equal(failure.status, "unavailable");
  assert.ok(failure.locations.length);
  assert.ok(!JSON.stringify(failure).includes("private"));
});
test("global search snapshots, specific destination, no-flight and family budget survive shareable URLs", () => {
  const to = normalizeLocation({
    ...city,
    code: "VIE",
    name: "Vienna",
    country_code: "AT",
    country_name: "Austria",
  })!;
  for (const cents of [100, 10000000]) {
    const r: TripRequest = {
      ...defaultRequest,
      originId: heathrow.id,
      origin: heathrow,
      destination: to,
      noFlight: true,
      party: { adults: 1, children: 3 },
      budget: { cents, currency: "EUR" },
    };
    const parsed = parseRequest(
      Object.fromEntries(new URLSearchParams(requestQuery(r))),
      locations,
      "2026-10-06",
    );
    assert.deepEqual(parsed, r);
  }
  const anywhere = parseRequest({ origin: "prishtina" });
  assert.equal(anywhere.destination, undefined);
  assert.equal(parseRequest({ originPlace: "not JSON" }).origin, undefined);
});
test("any weekend selects only complete Saturday-Monday pairs with actual dates and deterministic road defaults", async () => {
  const r = parseRequest(
    { origin: "prishtina", dateMode: "weekends", month: "2026-10" },
    locations,
    "2026-10-06",
  );
  assert.deepEqual(
    weekendsInMonth("2026-10", "2026-10-06").map((d) => d.startDate),
    ["2026-10-10", "2026-10-17", "2026-10-24", "2026-10-31"],
  );
  assert.equal(weekendsInMonth("not-a-month").length, 0);
  assert.equal(r.dates.mode, "weekends");
  assert.equal(r.nights, 2);
  assert.deepEqual(
    parseRequest(
      Object.fromEntries(new URLSearchParams(requestQuery(r))),
      locations,
      "2026-10-06",
    ),
    r,
  );
  const providers = await createTravelProviders({}, fixtureFetch);
  const search = await getTripTemplates(r, providers);
  const plan = pricePlan(search.templates[0], r);
  assert.equal(plan.request.dates.mode, undefined);
  assert.equal(plan.requestedDates?.mode, "weekends");
  assert.equal(plan.request.dates.startDate, "2026-10-10");
});
test("weekend flight discovery prices an eligible weekend and rejects weekday references", async () => {
  const r: TripRequest = {
    ...parseRequest(
      { dateMode: "weekends", month: "2026-10" },
      locations,
      "2026-10-06",
    ),
    origin: heathrow,
    originId: heathrow.id,
  };
  const providers = await createTravelProviders(
    { TRAVELPAYOUTS_API_TOKEN: "private" },
    fixtureFetch,
    false,
    r,
  );
  const search = await getTripTemplates(r, providers);
  const base = search.templates.find((b) => b.id === "vienna")!;
  assert.ok(base);
  const plan = pricePlan(base, r);
  assert.equal(plan.request.dates.startDate, "2026-10-17");
  assert.equal(plan.request.dates.endDate, "2026-10-19");
  assert.equal(plan.costs[0].amount.cents, 14000);
  assert.equal(
    fareDateMatch(
      {
        ...matchingFlight(plan)!,
        scope: {
          ...matchingFlight(plan)!.scope,
          dates: {
            startDate: "2026-10-16",
            endDate: "2026-10-18",
            flexibleDays: 0,
          },
        },
      },
      r,
    ),
    "reference",
  );
});
test("specific global destination constrains provider query and never substitutes other cities", async () => {
  const to = normalizeLocation({
    ...city,
    code: "VIE",
    name: "Vienna",
    country_code: "AT",
    country_name: "Austria",
  })!;
  const r = {
    ...defaultRequest,
    origin: heathrow,
    originId: heathrow.id,
    destination: to,
  };
  let queries = 0;
  const provider = await createTravelProviders(
    { TRAVELPAYOUTS_API_TOKEN: "private" },
    async (url, options) => {
      if (new URL(url).hostname === "api.travelpayouts.com") {
        queries++;
        assert.equal(new URL(url).searchParams.get("origin"), "LHR");
        assert.equal(new URL(url).searchParams.get("destination"), "VIE");
        assert.ok(options.headers);
      }
      return fixtureFetch(url);
    },
    false,
    r,
  );
  const search = await getTripTemplates(r, provider);
  assert.equal(queries, 1);
  assert.equal(search.templates.length, 1);
  assert.ok(matchesDestination(search.templates[0].destination, to));
  const noFlight = { ...r, noFlight: true };
  assert.equal(
    (await getTripTemplates(noFlight, provider)).templates.length,
    0,
  );
  assert.equal(queries, 1);
});
test("unsupported or country origins remain editable without flight calls or a silently selected airport", async () => {
  const country = normalizeLocation({
    type: "country",
    code: "GB",
    name: "United Kingdom",
    country_code: "GB",
  })!;
  const r = { ...defaultRequest, origin: country, originId: country.id };
  let calls = 0;
  const provider = await createTravelProviders(
    { TRAVELPAYOUTS_API_TOKEN: "private" },
    async () => {
      calls++;
      throw Error();
    },
    false,
    r,
  );
  assert.equal((await getTripTemplates(r, provider)).templates.length, 0);
  assert.equal(calls, 0);
});

test("single-airport city coordinates remain available without inventing an airport choice", () => {
  const city = normalizeLocation({
    type: "city",
    code: "ZRH",
    name: "Zurich",
    country_code: "CH",
    country_name: "Switzerland",
    main_airport_name: "Zurich Airport",
    coordinates: { lat: 47.37, lon: 8.55 },
  })!;
  assert.equal(city.type, "city");
  assert.equal(city.airportIata, undefined);
  assert.equal(city.cityCode, "ZRH");
  assert.deepEqual(readLocation(city)?.coordinates, {
    latitude: 47.37,
    longitude: 8.55,
  });
});

test("selected uncatalogued European city does not mutate demo catalogue when providers have no keys", async () => {
  const to = normalizeLocation({
    ...city,
    code: "LIS",
    name: "Lisbon",
    country_code: "PT",
    country_name: "Portugal",
  })!;
  const first = await createTravelProviders({}, fixtureFetch, false, {
    ...defaultRequest,
    destination: to,
  });
  assert.ok((await first.destinations.list()).some((d) => d.id === to.id));
  const second = await createTravelProviders({}, fixtureFetch);
  assert.equal(
    (await second.destinations.list()).some((d) => d.id === to.id),
    false,
  );
});

test("airport origins accept city-coded rows only with matching airport metadata", async () => {
  const r = { ...defaultRequest, origin: heathrow, originId: heathrow.id };
  for (const [actual, expected] of [
    ["LHR", 1],
    ["LGW", 0],
  ]) {
    const providers = await createTravelProviders(
      { TRAVELPAYOUTS_API_TOKEN: "private" },
      async (url) =>
        new URL(url).hostname === "api.travelpayouts.com"
          ? Response.json({
              success: true,
              currency: "EUR",
              data: [
                {
                  origin: "LON",
                  origin_airport: actual,
                  destination: "VIE",
                  price: 70,
                  found_at: new Date().toISOString(),
                  departure_at: r.dates.startDate,
                  return_at: r.dates.endDate,
                },
              ],
            })
          : Response.json({ batchcomplete: true }),
      false,
      r,
    );
    const result = await providers.discovery!.discover(r, heathrow);
    if (expected) {
      assert.notEqual(result.status, "unavailable");
      if (result.status !== "unavailable")
        assert.equal(result.value.fares.length, expected);
    } else assert.equal(result.status, "unavailable");
  }
});
