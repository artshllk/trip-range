/** Explicit live diagnostic: public city metadata + configured fare discovery; never prints headers/credentials/affiliate URLs. */
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const env = parseEnv(await readFile(".env.local", "utf8").catch(() => ""));
const {
  createTravelProviders,
} = require("../.test-build/src/providers/server/composition.js");
const { getTripTemplates } = require("../.test-build/src/services/travel.js");
const {
  defaultRequestFor,
  requestQuery,
} = require("../.test-build/src/domain/request.js");
const { pricePlan } = require("../.test-build/src/domain/pricing.js");
const { curate } = require("../.test-build/src/domain/ranking.js");
const { flightHandoff } = require("../.test-build/src/domain/affiliate.js");
const {
  createOpenAiIntent,
} = require("../.test-build/src/providers/server/ai/openai.js");
const {
  resolveTravelIntent,
} = require("../.test-build/src/services/ai/resolve-intent.js");
const {
  createLocationSearch,
} = require("../.test-build/src/providers/server/location-search.js");
const token = env.TRAVELPAYOUTS_API_TOKEN;
if (!token) {
  console.log("Flight discovery configuration: absent");
  process.exit(0);
}
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Belgrade",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const base = {
  ...defaultRequestFor(today),
  originId: "zurich",
  budget: { cents: 200000, currency: "EUR" },
  when: "custom",
  dates: { startDate: "2026-11-07", endDate: "2026-11-09", flexibleDays: 0 },
};
const cache = new Map();
let calls = [];
const fetcher = async (url, options) => {
  const u = new URL(url);
  if (u.hostname === "commons.wikimedia.org")
    return Response.json({ query: { pages: [] } });
  if (cache.has(url)) return cache.get(url).clone();
  const response = await fetch(url, options);
  calls.push({
    kind: u.hostname.includes("autocomplete") ? "metadata" : "discovery",
    status: response.status,
  });
  if (response.ok) cache.set(url, response.clone());
  return response;
};
async function search(label, r, preferred) {
  calls = [];
  const started = Date.now();
  const providers = await createTravelProviders(
    { TRAVELPAYOUTS_API_TOKEN: token },
    fetcher,
    false,
    r,
  );
  const result = await getTripTemplates(r, providers, preferred);
  const plans = result.templates.map((t) => pricePlan(t, r));
  const dynamic = plans.filter((p) => p.destination.metadataSource);
  const ranked = curate(plans, r);
  console.log(
    JSON.stringify({
      scenario: label,
      elapsedMs: Date.now() - started,
      requests: calls,
      templates: plans.length,
      dynamic: dynamic.map((p) => ({
        id: p.id,
        name: p.destination.name.en,
        departure: p.departure?.code,
        arrival:
          p.flight?.destinationAirport ??
          p.flight?.destinationCode ??
          p.referenceFare?.destinationCode,
        confidence: p.costs[0].confidence,
        dates: p.request.dates,
      })),
      displayed: ranked.fits.map((p) => p.id),
      issues: result.issues.length,
    }),
  );
  return { plans, dynamic };
}
await search("A Zurich Anywhere", base);
const b = await search("B Zurich city", { ...base, styles: ["city"] });
await search("C0 Prishtina selected airport", {
  ...base,
  originId: "prishtina",
});
await search("C Prishtina nearby", {
  ...base,
  originId: "prishtina",
  preferences: { ...base.preferences, nearbyAirports: true },
});
const target = b.dynamic[0];
if (target) {
  const d = target.destination;
  const r = {
    ...base,
    destination: {
      id: d.id,
      name: d.name.en,
      type: "city",
      cityCode: d.cityCode,
      iataCodes: [d.cityCode],
      countryCode: d.countryCode,
      countryName: d.country,
    },
  };
  const detail = await search("D specific dynamic detail", r, d.id);
  const route = detail.plans[0] && flightHandoff(detail.plans[0]);
  console.log(JSON.stringify({ scenario: "D handoff", route: route ?? null }));
}
await search("F low budget", {
  ...base,
  budget: { cents: 100, currency: "EUR" },
});
if (process.argv.includes("--ai")) {
  const parsed = await createOpenAiIntent({
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL || "gpt-6-luna",
  }).parse({
    locale: "sq",
    text: "Kam 700 euro per dy persona nga Zurich, vikendin tjeter, dua qytet.",
  });
  console.log(
    JSON.stringify({
      scenario: "E AI parsing",
      status: parsed.status,
      ...(parsed.status === "unavailable" ? { reason: parsed.reason } : {}),
    }),
  );
  if (parsed.status === "available") {
    const r = await resolveTravelIntent(
      parsed.intent,
      Object.fromEntries(new URLSearchParams(requestQuery(base))),
      "Kam 700 euro per dy persona nga Zurich, vikendin tjeter, dua qytet.",
      today,
      createLocationSearch(fetcher),
    );
    if (r.status === "ready")
      await search("E Albanian parsed search", r.request);
    else
      console.log(
        JSON.stringify({
          scenario: "E clarification",
          fields: r.clarifications.map((c) => c.field),
        }),
      );
  }
}
