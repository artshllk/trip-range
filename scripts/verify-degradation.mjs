/** Run against the explicit local provider-failure fixture only. */
import assert from "node:assert/strict";
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3112";
assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
for (const scope of ["domestic", "anywhere"]) {
  const r = await fetch(origin + `/plan/results?scope=${scope}&budget=2000`);
  assert.equal(r.status, 200);
  const html = (await r.text()).replace(
    /<script\b[^>]*>[\s\S]*?<\/script>/g,
    "",
  );
  assert.ok(
    html.includes('class="trip-card"'),
    "provider outage retains estimated trips",
  );
  if (scope === "domestic")
    assert.ok(
      !html.includes("Provider unavailable"),
      "no irrelevant flight warning for road trips",
    );
  else assert.ok(html.includes("Provider unavailable"));
  assert.ok(!html.includes("synthetic-phase6"));
}
for (const [path, body] of [
  [
    "/api/ai/intent",
    {
      text: "nature",
      locale: "en",
      draft: { origin: "prishtina", budget: "500" },
    },
  ],
  [
    "/api/affiliate/flights",
    {
      placement: "trip",
      route: {
        originCode: "PRN",
        destinationCode: "VIE",
        departureDate: "2026-11-07",
        returnDate: "2026-11-09",
        party: { adults: 2, children: 0 },
      },
    },
  ],
]) {
  const r = await fetch(origin + path, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal((await r.json()).status, "unavailable");
}
console.log(
  "PASS independent provider failure: trips retained, domestic warning suppressed, AI and affiliate fail safely",
);
