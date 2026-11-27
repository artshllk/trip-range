import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateEnvironment,
  configurationReport,
} from "../src/config/environment";
import { securityHeaders } from "../src/config/security";
import { localLimiter, redisLimiter, limits } from "../src/server/rate-limit";
import {
  safeOperationalEvent,
  reportOperation,
  type Provider,
  type Operation,
} from "../src/server/observability";
import { boundedJson } from "../src/server/request-body";
import { sanitizeAnalyticsEvent } from "../src/domain/analytics";
import { readAiBody } from "../src/services/ai/request-guard";
import { handleFlightAffiliate } from "../src/services/affiliate-handoff";
import { GET as health } from "../src/app/api/health/route";
const privateValue = "synthetic-private-value-not-a-real-credential";
test("keyless configuration keeps Wikimedia and deterministic planning available", () => {
  const config = validateEnvironment({ NODE_ENV: "production" });
  assert.deepEqual(config.capabilities, {
    flights: false,
    affiliate: false,
    ai: false,
    wikimedia: true,
    pexels: false,
    accommodationInventory: false,
    fareStore: false,
  });
  assert.equal(config.ai.model, "gpt-6-luna");
  assert.equal(configurationReport(config).blockers.length, 3);
});
test("central validation rejects malformed IDs, models and infrastructure URLs", () => {
  const c = validateEnvironment({
    TRAVELPAYOUTS_API_TOKEN: privateValue,
    TRAVELPAYOUTS_PROJECT_ID: "12e3",
    TRAVELPAYOUTS_MARKER: "2?private",
    GOEKSPLO_AI_ENABLED: "true",
    OPENAI_API_KEY: privateValue,
    OPENAI_MODEL: "bad model",
    RATE_LIMIT_REDIS_REST_URL: "https://attacker.invalid",
    RATE_LIMIT_REDIS_REST_TOKEN: privateValue,
  });
  assert.equal(c.capabilities.affiliate, false);
  assert.equal(c.capabilities.ai, false);
  assert.equal(c.redis, undefined);
  assert.equal(c.invalid.length, 4);
  assert.equal(
    JSON.stringify(configurationReport(c)).includes(privateValue),
    false,
  );
});
test("complete server configuration enables capabilities without exposing values in reports", () => {
  const c = validateEnvironment({
    TRAVELPAYOUTS_API_TOKEN: privateValue,
    TRAVELPAYOUTS_PROJECT_ID: "123",
    TRAVELPAYOUTS_MARKER: "456",
    GOEKSPLO_AI_ENABLED: "true",
    OPENAI_API_KEY: privateValue,
    PEXELS_API_KEY: privateValue,
    RATE_LIMIT_REDIS_REST_URL: "https://example.upstash.io",
    RATE_LIMIT_REDIS_REST_TOKEN: privateValue,
  });
  assert.equal(c.capabilities.affiliate, true);
  assert.equal(c.capabilities.ai, true);
  assert.deepEqual(configurationReport(c).blockers, []);
  assert.equal(
    JSON.stringify(configurationReport(c)).includes(privateValue),
    false,
  );
});
test("health is a cheap safe capability report, even with private configuration", async () => {
  const old = process.env.TRAVELPAYOUTS_API_TOKEN,
    original = globalThis.fetch;
  process.env.TRAVELPAYOUTS_API_TOKEN = privateValue;
  globalThis.fetch = async () => {
    throw Error("No health provider calls allowed");
  };
  try {
    const r = await health();
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    const raw = await r.text();
    assert.equal(raw.includes(privateValue), false);
    assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), [
      "capabilities",
      "status",
      "version",
    ]);
  } finally {
    if (old === undefined) delete process.env.TRAVELPAYOUTS_API_TOKEN;
    else process.env.TRAVELPAYOUTS_API_TOKEN = old;
    globalThis.fetch = original;
  }
});
test("bounded local limiter resets, isolates operations and rejects unknown keys", async () => {
  let now = 1;
  const l = localLimiter(() => now);
  for (let i = 0; i < limits["ai-intent"]; i++)
    assert.equal(await l.allow("ai-intent"), true);
  assert.equal(await l.allow("ai-intent"), false);
  assert.equal(await l.allow("affiliate"), true);
  assert.equal(await l.allow(privateValue as "affiliate"), false);
  now += 60000;
  assert.equal(await l.allow("ai-intent"), true);
});
test("distributed limiter uses atomic expiring counters and header-only credentials", async () => {
  const l = redisLimiter(
    { url: "https://example.upstash.io", token: privateValue },
    async (input, options) => {
      assert.equal(String(input).includes(privateValue), false);
      assert.equal(
        new Headers(options?.headers).get("Authorization"),
        `Bearer ${privateValue}`,
      );
      assert.equal(String(options?.body).includes(privateValue), false);
      const args = JSON.parse(String(options?.body));
      assert.equal(args[0], "EVAL");
      assert.ok(args[1].includes("PEXPIRE"));
      assert.equal(args[3], "goeksplo:v2:local:limit:ai-intent");
      assert.equal(options?.redirect, "error");
      return Response.json({ result: 1 });
    },
  );
  assert.equal(await l.allow("ai-intent"), true);
});
for (const status of [401, 429, 500])
  test(`distributed limiter falls back to per-instance counts on HTTP ${status}`, async () => {
    // A Redis failure never refuses on its own: the same limit is counted in memory.
    const l = redisLimiter(
      { url: "https://example.upstash.io", token: privateValue },
      async () => new Response(null, { status }),
      1200,
      { namespace: "goeksplo:v2:local", windowMs: 60000 },
      localLimiter(() => 0),
    );
    for (let i = 0; i < limits.affiliate; i++)
      assert.equal(await l.allow("affiliate"), true);
    assert.equal(await l.allow("affiliate"), false);
  });
test("distributed limiter treats malformed and oversized responses as unavailable, not as refusal", async () => {
  for (const body of [
    '{"result":"1"}',
    "invalid",
    JSON.stringify({ result: 1, padding: "x".repeat(1200) }),
  ])
    assert.equal(
      await redisLimiter(
        { url: "https://example.upstash.io", token: privateValue },
        async () => new Response(body),
      ).allow("affiliate"),
      true,
    );
});
test("only a real over-quota answer from Redis refuses", async () => {
  const l = redisLimiter(
    { url: "https://example.upstash.io", token: privateValue },
    async () => Response.json({ result: 0 }),
  );
  assert.equal(await l.allow("affiliate"), false);
});
test("distributed limiter bounds hung requests and slow response bodies, then counts locally", async () => {
  for (const fetcher of [
    async () => new Promise<Response>(() => {}),
    async () => new Response(new ReadableStream({ start() {} })),
  ]) {
    const start = Date.now();
    assert.equal(
      await redisLimiter(
        { url: "https://example.upstash.io", token: privateValue },
        fetcher,
        10,
      ).allow("affiliate"),
      true,
    );
    assert.ok(Date.now() - start < 1000);
  }
});
test("safe operational logger strips arbitrary values and cannot break requests", () => {
  const e = safeOperationalEvent(
    privateValue as Provider,
    privateValue as Operation,
    privateValue,
    Infinity,
  );
  assert.equal(JSON.stringify(e).includes(privateValue), false);
  assert.equal(e.durationMs, 0);
  reportOperation("openai", "intent", privateValue, 12, (event) => {
    assert.equal(event.status, "provider");
    throw Error(privateValue);
  });
});
test("production CSP bounds origins and excludes eval; localhost has no HSTS in base headers", () => {
  const h = Object.fromEntries(
    securityHeaders(true).map((h) => [h.key, h.value]),
  );
  assert.equal(h["X-Content-Type-Options"], "nosniff");
  assert.ok(h["Content-Security-Policy"].includes("frame-ancestors 'none'"));
  assert.ok(!h["Content-Security-Policy"].includes("unsafe-eval"));
  assert.ok(!h["Content-Security-Policy"].includes("https:;"));
  assert.equal(h["Strict-Transport-Security"], undefined);
});
test("request body parser bounds bytes, malformed JSON and slow uploads", async () => {
  assert.deepEqual(
    await boundedJson(
      new Request("https://example.test", {
        method: "POST",
        body: '{"ok":true}',
      }),
      40,
    ),
    { ok: true },
  );
  for (const body of ["x".repeat(50), "{bad"]) {
    assert.equal(
      await boundedJson(
        new Request("https://example.test", { method: "POST", body }),
        40,
      ),
      undefined,
    );
  }
  const slow = new Request("https://example.test", {
    method: "POST",
    body: new ReadableStream({ start() {} }),
    duplex: "half",
  } as RequestInit);
  assert.equal(await boundedJson(slow, 40, 10), undefined);
});
test("AI rejects cross-origin, content-type prefixes and wrong methods", async () => {
  for (const headers of [
    { origin: "https://other.test", "content-type": "application/json" },
    { origin: "https://example.test", "content-type": "application/jsonbad" },
  ])
    assert.equal(
      await readAiBody(
        new Request("https://example.test/api/ai/intent", {
          method: "POST",
          headers,
          body: "{}",
        }),
      ),
      undefined,
    );
  assert.equal(
    await readAiBody(
      new Request("https://example.test/api/ai/intent", {
        headers: {
          origin: "https://example.test",
          "content-type": "application/json",
        },
      }),
    ),
    undefined,
  );
});
test("affiliate rejects unknown input fields without invoking a provider", async () => {
  let calls = 0;
  const response = await handleFlightAffiliate(
    new Request("https://example.test/api/affiliate/flights", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        route: {
          originCode: "PRN",
          destinationCode: "VIE",
          departureDate: "2026-11-07",
          returnDate: "2026-11-09",
          party: { adults: 2, children: 0 },
        },
        placement: "trip",
        secret: privateValue,
      }),
    }),
    {
      createLink: async () => {
        calls++;
        return { status: "unavailable", reason: "configuration" };
      },
    },
  );
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
  assert.equal((await response.text()).includes(privateValue), false);
});
test("analytics drops unknown paths and redacts arbitrary destination segments", () => {
  assert.equal(
    sanitizeAnalyticsEvent({
      url: `https://goeksplo.com/private/${privateValue}`,
    }),
    null,
  );
  const result = sanitizeAnalyticsEvent({
    url: `https://goeksplo.com/plan/trips/${privateValue}?text=${privateValue}`,
  });
  assert.equal(result?.url.includes(privateValue), false);
});

import { boundedSearchQuery } from "../src/domain/request-limits";
test("search query parsing has aggregate and per-value bounds", () => {
  assert.equal(boundedSearchQuery({ budget: "300", scope: "domestic" }), true);
  for (const q of [
    { budget: ["1", "2"] },
    { originPlace: "x".repeat(2049) },
    Object.fromEntries(Array.from({ length: 41 }, (_, i) => [String(i), "x"])),
    Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [String(i), "x".repeat(2048)]),
    ),
  ])
    assert.equal(boundedSearchQuery(q), false);
});

import { getAppTripTemplates } from "../src/services/app-travel";
import { defaultRequest } from "../src/domain/request";
test("search throttle preserves selected dynamic estimates and does not report flight failure for domestic trips", async () => {
  const url = process.env.RATE_LIMIT_REDIS_REST_URL,
    token = process.env.RATE_LIMIT_REDIS_REST_TOKEN,
    fetcher = globalThis.fetch;
  process.env.RATE_LIMIT_REDIS_REST_URL = "https://test-quota.upstash.io";
  process.env.RATE_LIMIT_REDIS_REST_TOKEN = privateValue;
  globalThis.fetch = async (input) => {
    assert.equal(new URL(String(input)).hostname, "test-quota.upstash.io");
    return Response.json({ result: 0 });
  };
  try {
    const domestic = await getAppTripTemplates({
      ...defaultRequest,
      scope: "domestic",
    });
    // No demo road trips in production (2026-10-27).
    assert.ok(domestic.templates.every((t) => t.transport.mode !== "road"));
    assert.equal(
      domestic.issues.some((i) => i.destinationId === "flight-discovery"),
      false,
    );
    const international = await getAppTripTemplates(
      {
        ...defaultRequest,
        originId: "zurich",
        destination: {
          id: "city:VIE",
          type: "city",
          name: "Vienna",
          cityCode: "VIE",
          countryCode: "AT",
          countryName: { en: "Austria", sq: "Austria" },
        },
      },
      "city:VIE",
    );
    assert.ok(international.templates.some((t) => t.id === "city:VIE"));
    assert.ok(
      international.templates.every((t) =>
        t.transport.mode === "road"
          ? t.transport.price.confidence === "estimate"
          : t.transport.flightPricing.kind === "unavailable",
      ),
    );
    assert.equal(
      international.issues.some(
        (i) =>
          i.source.status === "unavailable" && i.source.reason === "rate-limit",
      ),
      true,
    );
  } finally {
    globalThis.fetch = fetcher;
    if (url === undefined) delete process.env.RATE_LIMIT_REDIS_REST_URL;
    else process.env.RATE_LIMIT_REDIS_REST_URL = url;
    if (token === undefined) delete process.env.RATE_LIMIT_REDIS_REST_TOKEN;
    else process.env.RATE_LIMIT_REDIS_REST_TOKEN = token;
  }
});

import { matchesRequestOrigin } from "../src/server/request-origin";
test("origin guard uses actual Host when Next URL uses an internal host, without trusting forwarded headers", () => {
  const r = new Request("http://localhost:3000/api/ai/intent", {
    headers: { host: "127.0.0.1:3000", "x-forwarded-host": "attacker.invalid" },
  });
  assert.equal(matchesRequestOrigin(r, "http://127.0.0.1:3000"), true);
  for (const origin of [
    "http://localhost:3000",
    "https://127.0.0.1:3000",
    "http://attacker.invalid",
    "null",
    "http://127.0.0.1:3000/path",
  ])
    assert.equal(matchesRequestOrigin(r, origin), false);
  assert.equal(
    matchesRequestOrigin(
      new Request("https://goeksplo.com", {
        headers: { host: "goeksplo.com@attacker.invalid" },
      }),
      "https://attacker.invalid",
    ),
    false,
  );
});
