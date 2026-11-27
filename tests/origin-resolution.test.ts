import assert from "node:assert/strict";
import { test } from "node:test";
import { originResolution, parseRequest } from "../src/domain/request";

// The shape /api/locations returned for "Tirana" (coordinates omitted).
const tirana = JSON.stringify({
  id: "city:TIA",
  name: "Tirana",
  type: "city",
  countryCode: "AL",
  countryName: { en: "Albania", sq: "Albania" },
  cityCode: "TIA",
  iataCodes: ["TIA"],
});

test("a picked place or a catalogue id identifies the origin", () => {
  assert.equal(
    originResolution({ origin: "city:TIA", originPlace: tirana }),
    "selected",
  );
  assert.equal(originResolution({ origin: "prishtina" }), "catalogue");
  assert.equal(originResolution({ origin: "Skopje" }), "catalogue");
});

test("an origin we cannot identify is unresolved, never the default", () => {
  for (const origin of ["vienna", "london", "nowhere-xyz"]) {
    assert.equal(originResolution({ origin }), "unresolved", origin);
    // parseRequest alone still falls back; that is exactly why pages must check.
    assert.equal(parseRequest({ origin }).originId, "tirana");
  }
  assert.equal(originResolution({ originPlace: "{not json" }), "unresolved");
  assert.equal(
    originResolution({ origin: "prishtina", originPlace: "{not json" }),
    "unresolved",
  );
  assert.equal(
    originResolution({ origin: ["prishtina", "skopje"] }),
    "unresolved",
  );
});

test("no origin at all is missing, not the default", () => {
  assert.equal(originResolution({}), "missing");
  assert.equal(originResolution({ origin: "" }), "missing");
});
