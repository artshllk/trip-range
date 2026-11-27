// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { searchArrivalEntry } from "../src/components/travel/search-arrival";
import {
  defaultRequest,
  parseRequest,
  requestQuery,
} from "../src/domain/request";
import type { TravelLocation, TripRequest } from "../src/domain/types";
import { createDestinationAccessStore } from "../src/travel/runtime/access-store";
import { destinationAccessData } from "./fixtures/archived-destination-data";
import { placeRegistryData } from "../content/places/records";
import { reviewedDetailArrival } from "../src/services/trip-detail-selection";

const arrivalEntry = { destinationId: "place:Q24451", code: "MQP" };
const country: TravelLocation = {
  id: "country:ZA",
  name: "South Africa",
  type: "country",
  countryCode: "ZA",
  countryName: { en: "South Africa", sq: "Afrika e Jugut" },
};
const initial: TripRequest = {
  ...defaultRequest,
  destination: country,
  arrivalEntry,
  departureAirport: "SKP",
};
const city: TravelLocation = {
  id: "city:PAR",
  name: "Paris",
  type: "city",
  cityCode: "PAR",
  countryCode: "FR",
  countryName: { en: "France", sq: "Francë" },
};
function apply(draft: TripRequest, edited: boolean, original = initial) {
  return new URLSearchParams(
    requestQuery({
      ...draft,
      departureAirport: undefined,
      arrivalEntry: searchArrivalEntry(original, draft.destination, edited),
    }),
  );
}
function absent(query: URLSearchParams) {
  assert.equal(query.has("arrival"), false);
  assert.equal(query.has("arrivalFor"), false);
}
function retained(query: URLSearchParams) {
  assert.equal(query.get("arrival"), "MQP");
  assert.equal(query.get("arrivalFor"), "place:Q24451");
  const restored = parseRequest(Object.fromEntries(query));
  const store = createDestinationAccessStore(
    destinationAccessData,
    placeRegistryData.records,
    () => Date.parse("2026-10-16T12:00:00Z"),
  );
  assert.equal(
    reviewedDetailArrival(
      arrivalEntry.destinationId,
      restored,
      store.get(arrivalEntry.destinationId),
    )?.airportCode,
    "MQP",
  );
}

test("changed destination serializes neither old arrival parameter; original request is untouched", () => {
  const before = structuredClone(initial);
  absent(apply({ ...initial, destination: city }, true));
  assert.deepEqual(initial, before);
  retained(new URLSearchParams(requestQuery(initial)));
});
test("explicit Anywhere clears a pin even when the saved trip came from Anywhere", () => {
  absent(apply({ ...initial, destination: undefined }, true));
  const anywhere = { ...initial, destination: undefined };
  absent(apply(anywhere, true, anywhere));
  retained(
    apply({ ...anywhere, party: { adults: 3, children: 1 } }, false, anywhere),
  );
});
for (const [name, patch] of Object.entries({
  budget: { budget: { cents: 90000, currency: "EUR" as const } },
  party: { party: { adults: 3, children: 1 } },
  dates: {
    dates: { startDate: "2027-02-20", endDate: "2027-02-22", flexibleDays: 0 },
  },
  preferences: { preferences: { ...initial.preferences, luggage: true } },
}))
  test(`${name}-only edit preserves the original canonical pin, not the broad country identity`, () => {
    retained(apply({ ...initial, ...patch }, false));
  });
test("away and back to the same broad country does not establish canonical destination identity", () => {
  absent(apply({ ...initial, destination: { ...country } }, true));
});
for (const [name, destination] of Object.entries({
  "same name, different city": { ...city, name: "Kruger National Park" },
  "overlapping gateway code": {
    ...city,
    id: "city:NLP",
    cityCode: "NLP",
    countryCode: "ZA",
  },
  "same operational airport": {
    ...city,
    id: "airport:MQP",
    type: "airport" as const,
    airportIata: "MQP",
  },
  "competing operational airport": {
    ...city,
    id: "airport:SZK",
    type: "airport" as const,
    airportIata: "SZK",
  },
  "unknown selection": undefined,
}))
  test(`${name} cannot inherit the previous canonical pin`, () => {
    absent(apply({ ...initial, destination }, true));
  });
test("reselected canonical identity can retain existing context, but never a conflicting airport", () => {
  // Policy input only: the current autocomplete does not offer canonical non-city places.
  const canonical: TravelLocation = {
    id: arrivalEntry.destinationId,
    type: "city",
    name: "Kruger National Park",
    countryCode: "ZA",
    countryName: country.countryName,
  };
  const query = apply({ ...initial, destination: canonical }, true);
  retained(query);
  absent(
    apply(
      { ...initial, destination: { ...canonical, airportIata: "SZK" } },
      true,
    ),
  );
  absent(
    apply(
      { ...initial, destination: { ...canonical, id: "place:Q34600" } },
      true,
    ),
  );
});
test("a replaced destination snapshot cannot bypass invalidation by omitting the interaction flag", () => {
  absent(apply({ ...initial, destination: city }, false));
  absent(apply({ ...initial, destination: { ...country } }, false));
});
test("no hint is invented and retained syntax never bypasses reviewed access validation", () => {
  assert.equal(
    searchArrivalEntry({ ...initial, arrivalEntry: undefined }, country, false),
    undefined,
  );
  const forged = { ...initial, arrivalEntry: { ...arrivalEntry, code: "AAA" } };
  const restored = parseRequest(
    Object.fromEntries(apply(forged, false, forged)),
  );
  const store = createDestinationAccessStore(
    destinationAccessData,
    placeRegistryData.records,
    () => Date.parse("2026-10-16T12:00:00Z"),
  );
  assert.equal(
    reviewedDetailArrival(
      arrivalEntry.destinationId,
      restored,
      store.get(arrivalEntry.destinationId),
    ),
    undefined,
  );
});
