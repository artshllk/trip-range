import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultPlanOrigin,
  planOrigin,
  planOriginByCode,
  planOrigins,
} from "../src/domain/plan-origins";
import { collectorOrigins } from "../src/domain/fare-refresh";
import { isMonthDiscovery } from "../src/domain/month-discovery";
import { monthPlace } from "../src/domain/month-places";
import names from "../src/domain/flight-city-names.json";

test("the /plan origin picker offers exactly the collected origins, Tirana by default", () => {
  assert.deepEqual(
    planOrigins.map((o) => o.code).sort(),
    [...collectorOrigins].sort(),
  );
  assert.equal(defaultPlanOrigin.code, "TIA");
  assert.equal(planOriginByCode("LON")?.slug, "london");
});

test("depart comes only from the URL and never fails the page", () => {
  assert.equal(planOrigin(undefined).origin.code, "TIA");
  assert.equal(planOrigin("").origin.code, "TIA");
  assert.equal(planOrigin("london").origin.code, "LON");
  assert.equal(planOrigin(" Barcelona ").origin.code, "BCN");
  assert.equal(planOrigin("warsaw").unknown, undefined);
  // A typo in a shared link shows the default and says so.
  assert.deepEqual(planOrigin("londn"), {
    origin: defaultPlanOrigin,
    unknown: "londn",
  });
  assert.equal(planOrigin(["london", "paris"]).origin.code, "TIA");
  assert.equal(planOrigin(["london"]).unknown, "that place");
});

test("depart keeps /plan on the month view; planner parameters still switch to search", () => {
  assert.ok(isMonthDiscovery({ depart: "london" }));
  assert.ok(
    isMonthDiscovery({ depart: "barcelona", month: "2026-12", ceiling: "800" }),
  );
  assert.equal(isMonthDiscovery({ origin: "skopje" }), false);
  assert.equal(isMonthDiscovery({ from: "Prishtina" }), false);
});

test("reviewed destination names: openly licensed, complete, and never displacing curated ones", () => {
  assert.match(names.source, /OurAirports/);
  assert.match(names.source, /Unlicense/);
  for (const [code, value] of Object.entries(names.places)) {
    assert.match(code, /^[A-Z]{3}$/, code);
    assert.equal(value.length, 3, code);
    const [name, countryCode, country] = value;
    assert.ok(name.trim() && country.trim(), code);
    assert.match(countryCode, /^[A-Z]{2}$/, code);
  }
  // Reviewed corrections of suburb or ambiguous municipalities.
  assert.equal(monthPlace("KRK")?.name, "Kraków");
  assert.equal(monthPlace("SZY")?.name, "Olsztyn");
  assert.equal(monthPlace("IZM")?.name, "İzmir");
  assert.equal(monthPlace("YXU")?.name, "London, Ontario");
  assert.equal(monthPlace("BJV")?.country, "Türkiye");
  // Curated tables still win: LON is London, United Kingdom.
  assert.equal(monthPlace("LON")?.name, "London");
  assert.equal(monthPlace("LON")?.countryCode, "GB");
});
