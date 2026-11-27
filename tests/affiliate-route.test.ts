import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../src/app/api/affiliate/flights/route";
import * as limiter from "../src/server/rate-limit";
import * as affiliates from "../src/providers/server/affiliates";
import type {
  FlightHandoff,
  AffiliatePlacement,
} from "../src/domain/affiliate";

const origin = "https://goeksplo-netlify-free.netlify.app";
const route = {
  originCode: "PRN",
  destinationCode: "VIE",
  departureDate: "2026-11-24",
  returnDate: "2026-11-27",
  party: { adults: 2, children: 1 },
};
const result = {
  status: "available" as const,
  link: { provider: "aviasales", url: "https://aviasales.tp.st/TestLink" },
};
function request(method = "POST", headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/affiliate/flights`, {
    method,
    headers: { origin, "Content-Type": "application/json", ...headers },
    ...(["GET", "HEAD"].includes(method)
      ? {}
      : { body: JSON.stringify({ route, placement: "trip" }) }),
  });
}

for (const [name, make] of [
  [
    "foreign origin",
    () => request("POST", { origin: "https://attacker.invalid" }),
  ],
  [
    "wrong scheme",
    () => request("POST", { origin: origin.replace("https:", "http:") }),
  ],
  ["opaque origin", () => request("POST", { origin: "null" })],
  [
    "cross-site metadata",
    () => request("POST", { "Sec-Fetch-Site": "cross-site" }),
  ],
  ["GET method", () => request("GET")],
  ["PUT method", () => request("PUT")],
  [
    "wrong content type",
    () => request("POST", { "Content-Type": "text/plain" }),
  ],
  [
    "missing content type",
    () => {
      const r = request();
      r.headers.delete("content-type");
      return r;
    },
  ],
] as const)
  test(`affiliate route rejects ${name} before quota or provider access`, async (t) => {
    const quota = t.mock.method(limiter, "allowOperation", async () => true);
    const provider = t.mock.method(affiliates, "affiliateProviders", () => {
      throw Error("Rejected requests must not reach the provider");
    });
    const response = await POST(make());
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { status: "unavailable" });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-robots-tag"), "noindex");
    assert.equal(quota.mock.callCount(), 0);
    assert.equal(provider.mock.callCount(), 0);
  });

test("valid affiliate request cannot reach the provider when quota denies it", async (t) => {
  const quota = t.mock.method(limiter, "allowOperation", async () => false);
  const provider = t.mock.method(affiliates, "affiliateProviders", () => {
    throw Error("Denied requests must not reach the provider");
  });
  const response = await POST(request());
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { status: "unavailable" });
  assert.equal(response.headers.get("retry-after"), "60");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-robots-tag"), "noindex");
  assert.deepEqual(
    quota.mock.calls.map((c) => c.arguments),
    [["affiliate"]],
  );
  assert.equal(provider.mock.callCount(), 0);
});

for (const withOrigin of [true, false])
  test(`accepted affiliate request preserves handoff after quota (${withOrigin ? "browser" : "existing non-browser client"})`, async (t) => {
    const order: string[] = [];
    t.mock.method(
      limiter,
      "allowOperation",
      async (operation: limiter.LimitOperation) => {
        assert.equal(operation, "affiliate");
        order.push("quota");
        return true;
      },
    );
    t.mock.method(affiliates, "affiliateProviders", () => {
      order.push("provider");
      return {
        flight: {
          async createLink(
            actualRoute: FlightHandoff,
            placement: AffiliatePlacement,
          ) {
            order.push("conversion");
            assert.deepEqual(actualRoute, route);
            assert.equal(placement, "trip");
            return result;
          },
        },
      };
    });
    const r = request("POST", {
      "Content-Type": "application/json; charset=utf-8",
    });
    if (!withOrigin) r.headers.delete("origin");
    const response = await POST(r);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), result);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-robots-tag"), "noindex");
    assert.deepEqual(order, ["quota", "provider", "conversion"]);
  });
