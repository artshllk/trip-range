import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  originPath,
  weekendPath,
  budgetPath,
  landingId,
  landingPath,
  type SeoLandingKey,
} from "../src/seo/identity";
import {
  seoLandingRegistry,
  approvedLanding,
  type SeoLandingDefinition,
} from "../src/seo/registry";
import { worldwideSeoDrafts } from "../src/seo/drafts";
import { seoRequest } from "../src/seo/summary";
import { editorialQuality } from "../src/seo/policy";
import { landingModel, seoSitemap } from "../src/seo/publication";
import {
  publicationCurrency,
  planningCurrency,
} from "../src/domain/market/policy";
import { readLogLevel, shouldLog } from "../src/server/observability/log-level";
import {
  safeDiagnosticEvent,
  type DiagnosticEvent,
} from "../src/server/observability/diagnostic";
import { reportDiagnostic } from "../src/server/observability";
import { validateEnvironment } from "../src/config/environment";
test("generic SEO identity is stable, URL-safe, currency explicit and supports worldwide slugs", () => {
  for (const origin of [
    "zurich",
    "london",
    "new-york",
    "tokyo",
    "cape-town",
    "dubai",
    "sydney",
  ]) {
    assert.equal(originPath(origin), `/from/${origin}`);
    assert.equal(weekendPath(origin), `/from/${origin}/weekend-trips`);
    assert.equal(
      budgetPath(origin, 500),
      `/from/${origin}/weekend-trips-under-500`,
    );
    const key: SeoLandingKey = {
      locale: "en",
      originId: origin,
      intent: "budget",
      budget: { cents: 50000, currency: "GBP" },
    };
    assert.equal(landingId(key), `en-${origin}-budget-gbp-50000`);
    assert.equal(landingPath(key), budgetPath(origin, 500));
  }
  for (const invalid of ["London", "../london", "london?x=1", "", "a//b"])
    assert.throws(() => originPath(invalid));
  for (const invalid of [-1, 0, 5.5, Infinity, 100001])
    assert.throws(() => budgetPath("london", invalid));
  assert.throws(() =>
    landingId({
      locale: "sq",
      originId: "london",
      intent: "origin",
    } as unknown as SeoLandingKey),
  );
});
test("Zurich preserves EUR publication semantics while new product searches default CHF", () => {
  const zurichPages = seoLandingRegistry.filter(
    (p) => p.origin.id === "zurich",
  );
  assert.deepEqual(
    zurichPages.map((p) => p.path),
    [
      "/from/zurich",
      "/from/zurich/weekend-trips",
      "/from/zurich/weekend-trips-under-500",
    ],
  );
  for (const page of zurichPages) {
    assert.equal(page.id, landingId(page.key));
    assert.equal(page.path, landingPath(page.key));
    assert.equal(publicationCurrency(page.origin), "EUR");
    assert.equal(planningCurrency(page.origin).currency, "CHF");
    assert.equal(seoRequest(page, "2026-10-07").budget.currency, "EUR");
  }
});
test("London GBP and New York USD drafts fit the generic model but never authorize publication", () => {
  for (const draft of worldwideSeoDrafts) {
    assert.equal(draft.key.intent, "budget");
    if (draft.key.intent !== "budget") throw Error();
    const page: SeoLandingDefinition = {
      ...seoLandingRegistry[2],
      ...draft,
      id: landingId(draft.key),
      path: landingPath(draft.key),
      budget: draft.key.budget,
      exampleBudget: draft.key.budget,
      planningCurrency: draft.key.budget.currency,
      intro: `Compare ${draft.h1.toLowerCase()} with full planning costs, a safety reserve and clear fare provenance.`,
      keywords: { primary: draft.h1, related: [] },
      related: [],
      parent: undefined,
    };
    const m = landingModel(
      page,
      { state: "configuration", search: { templates: [], issues: [] } },
      "2026-10-07",
      "2026-10-07T12:00:00Z",
    );
    assert.equal(
      seoRequest(page, "2026-10-07").budget.currency,
      draft.key.budget.currency,
    );
    assert.equal(m.quality.indexable, false);
    assert.equal(approvedLanding(page.path), undefined);
    assert.ok(!seoSitemap().some((e) => e.url.endsWith(page.path)));
    const quality = editorialQuality({ ...page, approved: true }, [
      { ...page, approved: true },
    ]);
    assert.equal(quality.indexable, false);
    assert.ok(quality.reasons.includes("not approved for publication"));
    assert.equal(quality.reasons.includes("invalid budget intent"), false);
    assert.equal(quality.reasons.includes("invalid normalized origin"), false);
    assert.equal(
      quality.reasons.includes("publication identity mismatch"),
      false,
    );
    assert.equal(
      quality.reasons.includes("publication currency policy mismatch"),
      false,
    );
    assert.equal(
      quality.reasons.includes("editorial intent needs review"),
      false,
    );
  }
});
test("SEO budget path, money, key and displayed currency must agree", () => {
  const page = seoLandingRegistry[2];
  assert.deepEqual(editorialQuality(page), editorialQuality(page));
  assert.equal(editorialQuality(page).indexable, true);
  for (const changed of [
    { ...page, budget: { cents: 70000, currency: "EUR" as const } },
    { ...page, planningCurrency: "CHF" as const },
    { ...page, h1: page.h1.replace("€", "£") },
  ])
    assert.equal(editorialQuality(changed).indexable, false);
});
test("server-only log levels default safely and suppress production debug noise", () => {
  assert.equal(readLogLevel(undefined), "info");
  assert.equal(readLogLevel("secret-unknown"), "info");
  assert.equal(
    validateEnvironment({ GOEKSPLO_LOG_LEVEL: "debug" }).logLevel,
    "debug",
  );
  assert.equal(shouldLog("debug", "info"), false);
  assert.equal(shouldLog("error", "off"), false);
  assert.equal(shouldLog("warn", "info"), true);
});
test("structured diagnostics reconstruct only allowlisted values and never retain private context", () => {
  const unsafe = {
    level: "debug",
    component: "provider",
    operation: "provider-currency",
    status: "mismatch",
    originCode: "LON",
    currency: "GBP",
    count: 999999,
    durationMs: 999999,
    token: "synthetic-secret",
    prompt: "private prompt",
    headers: { cookie: "secret" },
    url: "https://tp.media/?marker=private",
    destinationCode: "private-user",
    market: "private",
  } as unknown as DiagnosticEvent;
  const safe = safeDiagnosticEvent(unsafe);
  assert.deepEqual(safe, {
    level: "debug",
    component: "provider",
    operation: "provider-currency",
    status: "mismatch",
    originCode: "LON",
    currency: "GBP",
    count: 1000,
    durationMs: 60000,
  });
  let event;
  reportDiagnostic(unsafe, (value) => {
    event = value;
  });
  assert.deepEqual(event, safe);
  assert.doesNotMatch(
    JSON.stringify(event),
    /secret|private|prompt|headers|https/,
  );
});
test("application runtime has no direct console or environment access outside approved boundaries", () => {
  function scan(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? scan(`${dir}/${e.name}`)
        : /\.[jt]sx?$/.test(e.name)
          ? [`${dir}/${e.name}`]
          : [],
    );
  }
  for (const path of scan("src")) {
    const source = readFileSync(path, "utf8");
    if (path !== "src/server/observability.ts")
      assert.doesNotMatch(source, /\bconsole\s*\./, path);
    if (path !== "src/providers/server/environment.ts")
      assert.doesNotMatch(source, /\bprocess\.env/, path);
  }
});
