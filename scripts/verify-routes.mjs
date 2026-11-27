import assert from "node:assert/strict";
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3000";
const cases = [
  ["/", 200, "en", false],
  ["/sq", 200, "sq", false],
  ["/plan", 200, "en", true],
  ["/sq/plan/results?budget=200", 200, "sq", true],
  ["/plan/results?budget=200&styles=beach", 200, "en", true],
  ["/plan/trips/rugova?budget=300&scenario=price-change", 200, "en", true],
  ["/from/prishtina/weekend-trips/under-300", 200, "en", true],
  ["/sq/nga/prishtina/fundjava/nen-300?time=under2", 200, "sq", true],
  ["/offers", 404],
  ["/offers/retired-trip", 404],
  ["/agencies", 404],
  ["/agencies/retired-agency", 404],
  ["/api/inquiry", 404],
  ["/de", 404],
  ["/plan/trips/missing", 404],
  ["/sq/from/prishtina/weekend-trips/under-300", 404],
];
for (const [path, status, lang, noindex] of cases) {
  const response = await fetch(origin + path, { redirect: "manual" });
  const html = await response.text();
  assert.equal(response.status, status, path);
  if (lang) {
    assert.match(html, new RegExp(`<html[^>]*lang="${lang}"`), path + " lang");
    assert.equal(
      /<meta name="robots" content="noindex, follow"/.test(html),
      noindex,
      path + " robots",
    );
    assert.ok(
      !/docs.google.com\/spreadsheets|wa.me\//.test(html),
      path + " legacy dependencies",
    );
  }
  console.log(`PASS ${status} ${path}`);
}
const root = await fetch(origin, { redirect: "manual" });
assert.equal(root.status, 307);
assert.equal(root.headers.get("location"), "/");
const collection = await (
  await fetch(origin + "/sq/nga/prishtina/fundjava/nen-300?time=under2")
).text();
assert.match(
  collection,
  /<link rel="canonical" href="https:\/\/www\.trip-range\.com\/sq\/nga\/prishtina\/fundjava\/nen-300"/,
);
for (const lang of ["en", "sq", "x-default"])
  assert.ok(collection.includes(`hrefLang="${lang}"`), "alternate " + lang);
const sitemap = await (await fetch(origin + "/sitemap.xml")).text();
assert.equal((sitemap.match(/<loc>/g) || []).length, 2);
assert.ok(!sitemap.includes("/plan"));
assert.ok(!sitemap.includes("under-300"));
console.log(
  "PASS root locale redirect, clean canonical, hreflang and approved-only sitemap",
);

for (const [locale, title] of [
  ["en", "Find Trips That Fit Your Budget"],
  ["sq", "Gjej Udhëtime Brenda Buxhetit Tënd"],
]) {
  const html = await (await fetch(`${origin}/${locale}`)).text();
  assert.ok(
    html.includes(`<title>${title} — GoEksplo</title>`),
    "localized product title",
  );
}
const resultHtml = await (
  await fetch(`${origin}/plan/results?budget=300&origin=prishtina`)
).text();
assert.ok(
  resultHtml.includes("<strong>€197</strong>"),
  "main card price excludes €20 reserve",
);
assert.ok(resultHtml.includes("Estimated whole trip"));
assert.ok(resultHtml.includes("Budget needed"));
assert.ok(resultHtml.includes("left after safety reserve"));
const changedHtml = await (
  await fetch(`${origin}/plan/trips/rugova?budget=300&scenario=price-change`)
).text();
assert.ok(
  !changedHtml
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
    .includes("Saved estimated trip cost"),
  "production ignores demo scenario query",
);
assert.ok(
  !changedHtml.includes('class="scenario-controls"'),
  "production has no demo controls",
);
const migrated = await (
  await fetch(`${origin}/plan/results?from=Skopje&styles=kosovo,city`)
).text();
assert.ok(migrated.includes("origin=skopje"));
assert.ok(migrated.includes("scope=domestic"));
assert.ok(migrated.includes("Skopje"));
console.log(
  "PASS Phase 1.5 spend/reserve copy, price delta, location migration and localized metadata",
);

const home = await (await fetch(`${origin}/`)).text();
assert.ok(home.includes('class="search-bar"'), "homepage shared search");
assert.ok(home.includes("From") && home.includes("Anywhere"));
assert.ok(resultHtml.includes('class="results-filters"'));
assert.ok(resultHtml.includes("Edit search"));
assert.ok(
  !resultHtml.includes('class="search-bar"'),
  "results start with compact summary",
);
assert.ok(changedHtml.includes("Edit search"));
assert.ok(
  !changedHtml.includes('class="search-bar"'),
  "detail starts with summary only",
);
const locations = await fetch(`${origin}/api/locations?q=x`);
assert.equal(locations.status, 200);
assert.equal(locations.headers.get("x-robots-tag"), "noindex");
assert.deepEqual(await locations.json(), {
  locations: [],
  status: "available",
});
const specific = await (
  await fetch(
    `${origin}/plan/results?budget=2000&noFlight=1&toPlace=${encodeURIComponent(
      JSON.stringify({
        id: "prizren",
        type: "city",
        name: "Prizren",
        countryCode: "XK",
        countryName: { en: "Kosovo", sq: "Kosova" },
      }),
    )}`,
  )
).text();
assert.ok(specific.includes("/plan/trips/prizren?"));
assert.ok(!specific.includes("/plan/trips/mirusha?"));
assert.ok(
  !specific
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
    .includes("Provider unavailable"),
  "no visible provider failure for a road search",
);
console.log(
  "PASS shared search, detail summary, keyless location boundary and specific no-flight destination",
);

const toVienna = encodeURIComponent(
  JSON.stringify({
    id: "city:VIE",
    type: "city",
    name: "Vienna",
    cityCode: "VIE",
    countryCode: "AT",
    countryName: { en: "Austria", sq: "Austria" },
  }),
);
const flightHtml = await (
  await fetch(
    `${origin}/plan/trips/city%3AVIE?origin=zurich&budget=2000&toPlace=${toVienna}`,
  )
).text();
const visibleFlight = flightHtml.replace(
  /<script\b[^>]*>[\s\S]*?<\/script>/g,
  "",
);
assert.ok(visibleFlight.includes("Check current flights on Aviasales"));
assert.ok(visibleFlight.includes("General stay planning estimate"));
assert.ok(visibleFlight.includes("Other estimated trip costs"));
assert.ok(!visibleFlight.includes("€440"));
assert.ok(!visibleFlight.includes("left after buffer"));
assert.ok(visibleFlight.includes("Current price unavailable"));
assert.ok(visibleFlight.includes("may earn a commission"));
assert.ok(
  !/href="https:\/\/(?:www\.)?(?:aviasales\.com|booking\.com|trip\.com|agoda\.com)/.test(
    visibleFlight,
  ),
  "no unconverted flight or inactive hotel affiliate links",
);
const invalidAffiliate = await fetch(`${origin}/api/affiliate/flights`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
});
assert.equal(invalidAffiliate.status, 400);
assert.equal(invalidAffiliate.headers.get("x-robots-tag"), "noindex");
if (process.env.VERIFY_AFFILIATE_MISSING === "1") {
  const handoff = await fetch(`${origin}/api/affiliate/flights`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      route: {
        originCode: "ZRH",
        destinationCode: "VIE",
        departureDate: "2026-11-05",
        returnDate: "2026-11-08",
        party: { adults: 2, children: 0 },
      },
      placement: "trip",
    }),
  });
  assert.equal(handoff.status, 503);
  assert.deepEqual(await handoff.json(), { status: "unavailable" });
}
console.log(
  "PASS flight handoff UI, honest estimates, disclosure, no hotel links and safe affiliate endpoint",
);
