import { demoProviders } from "../src/providers/demo";
import { getTripTemplates } from "../src/services/travel";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  configurationReport,
  startupConfigurationErrors,
  validateEnvironment,
} from "../src/config/environment";
import { deploymentMode, limiterNamespace } from "../src/config/deployment";
import {
  configurationReadiness,
  launchReadiness,
  legalPlaceholderReport,
  productionVerificationExitCode,
} from "../src/config/readiness";
import { deploymentIndexingHeaders } from "../src/config/security";
import {
  createRequestLimiter,
  limits,
  redisLimiter,
} from "../src/server/rate-limit";
import {
  offlineRateLimitCheck,
  liveRateLimitCheck,
} from "../scripts/check-rate-limit";
import { GET as health } from "../src/app/api/health/route";
import { GET as ready } from "../src/app/api/ready/route";
import {
  getAppTripTemplates,
  getDemoImageTemplates,
} from "../src/services/app-travel";
import { defaultRequest } from "../src/domain/request";
import { pricePlan } from "../src/domain/pricing";
import { createRequire } from "node:module";
const secret = "synthetic-server-credential-for-testing";
const configured = {
  VERCEL: "1",
  VERCEL_ENV: "production",
  NODE_ENV: "production",
  TRAVELPAYOUTS_API_TOKEN: secret,
  TRAVELPAYOUTS_PROJECT_ID: "123",
  TRAVELPAYOUTS_MARKER: "456",
  RATE_LIMIT_REDIS_REST_URL: "https://fixture.upstash.io",
  RATE_LIMIT_REDIS_REST_TOKEN: secret,
  DATABASE_URL: "postgresql://fixture:fixture@localhost/fixture",
};
const noFetch: typeof fetch = async () => {
  throw Error("No external fetch permitted");
};
function fakeRedis() {
  let now = 0;
  const buckets = new Map<string, { count: number; until: number }>();
  const commands: string[][] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    const args: string[] = JSON.parse(String(init?.body));
    commands.push(args);
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      `Bearer ${secret}`,
    );
    assert.equal(String(init?.body).includes(secret), false);
    if (args[0] === "PTTL")
      return Response.json({
        result: (buckets.get(args[1])?.until ?? now - 2) - now,
      });
    assert.equal(args[0], "EVAL");
    assert.match(args[1], /redis.call\('INCR'/);
    assert.match(args[1], /if n==1 then redis.call\('PEXPIRE'/);
    assert.equal(args[2], "1");
    const key = args[3];
    let bucket = buckets.get(key);
    if (!bucket || bucket.until <= now) {
      bucket = { count: 0, until: now + Number(args[4]) };
      buckets.set(key, bucket);
    }
    return Response.json({ result: ++bucket.count <= Number(args[5]) ? 1 : 0 });
  };
  return {
    fetcher,
    commands,
    advance(ms: number) {
      now += ms;
    },
  };
}
test("local dev, local production and CI remain local; deployed markers cannot be bypassed by NODE_ENV", async () => {
  for (const env of [
    {},
    { NODE_ENV: "production" },
    { NODE_ENV: "test" },
    { CI: "true" },
    { VERCEL: "1", VERCEL_ENV: "development" },
  ]) {
    const config = validateEnvironment(env);
    assert.equal(config.limiter, "local");
    assert.equal(
      await createRequestLimiter(config, noFetch).allow("search"),
      true,
    );
  }
  assert.equal(
    deploymentMode({ ...configured, NODE_ENV: "test", CI: "true" }),
    "production",
  );
  assert.equal(
    validateEnvironment({ VERCEL_ENV: "production" }).limiter,
    "required-but-unavailable",
  );
});
test("production missing/malformed Redis denies every protected operation without local or external fallback", async () => {
  for (const change of [
    { RATE_LIMIT_REDIS_REST_URL: "", RATE_LIMIT_REDIS_REST_TOKEN: "" },
    { RATE_LIMIT_REDIS_REST_URL: "http://fixture.upstash.io" },
    { RATE_LIMIT_REDIS_REST_TOKEN: "" },
    { RATE_LIMIT_REDIS_REST_URL: "https://user:password@fixture.upstash.io" },
    { RATE_LIMIT_REDIS_REST_URL: "https://fixture.upstash.io/path?secret=x" },
  ]) {
    let calls = 0;
    const env = validateEnvironment({ ...configured, ...change });
    assert.equal(env.limiter, "required-but-unavailable");
    const limiter = createRequestLimiter(env, async () => {
      calls++;
      throw Error(secret);
    });
    for (const operation of Object.keys(limits) as (keyof typeof limits)[])
      assert.equal(await limiter.allow(operation), false);
    assert.equal(calls, 0);
  }
});
test("keyless preview is bounded locally; any provider credential requires distributed protection", () => {
  const preview = { VERCEL: "1", VERCEL_ENV: "preview" };
  assert.equal(validateEnvironment(preview).limiter, "local");
  for (const name of [
    "OPENAI_API_KEY",
    "TRAVELPAYOUTS_API_TOKEN",
    "PEXELS_API_KEY",
  ])
    for (const value of [secret, "invalid\ncredential"]) {
      assert.equal(
        validateEnvironment({ ...preview, [name]: value }).limiter,
        "required-but-unavailable",
      );
    }
  assert.equal(
    validateEnvironment({ ...configured, VERCEL_ENV: "preview" }).limiter,
    "distributed",
  );
});
test("ambiguous deployment configuration fails closed and preview indexing is suppressed", () => {
  for (const env of [
    { VERCEL: "1" },
    { VERCEL_ENV: "unknown" },
    { VERCEL: "0", VERCEL_ENV: "production" },
    { VERCEL: "unexpected" },
  ]) {
    const config = validateEnvironment(env);
    assert.equal(config.mode, "invalid");
    assert.equal(config.limiter, "required-but-unavailable");
    assert.ok(config.invalid.includes("DEPLOYMENT_CONFIGURATION"));
  }
  assert.deepEqual(deploymentIndexingHeaders("preview"), [
    { key: "X-Robots-Tag", value: "noindex, nofollow" },
  ]);
  assert.deepEqual(deploymentIndexingHeaders("production"), []);
});
test("production distributed N/N+1/next-window behavior is shared and preview namespace is separate", async () => {
  const redis = fakeRedis();
  const production = createRequestLimiter(
    validateEnvironment(configured),
    redis.fetcher,
  );
  const preview = createRequestLimiter(
    validateEnvironment({ ...configured, VERCEL_ENV: "preview" }),
    redis.fetcher,
  );
  for (let n = 0; n < limits["ai-intent"]; n++)
    assert.equal(await production.allow("ai-intent"), true);
  assert.equal(await production.allow("ai-intent"), false);
  assert.equal(await preview.allow("ai-intent"), true);
  assert.equal(redis.commands[0][3], "goeksplo:v2:production:limit:ai-intent");
  assert.equal(
    redis.commands[redis.commands.length - 1][3],
    "goeksplo:v2:preview:limit:ai-intent",
  );
  redis.advance(60000);
  assert.equal(await production.allow("ai-intent"), true);
  assert.throws(() => limiterNamespace("production", "bad:user-input"));
  let called = false;
  assert.equal(
    await redisLimiter(
      validateEnvironment(configured).redis!,
      async () => {
        called = true;
        throw Error();
      },
      10,
      { namespace: "attacker:shared", windowMs: 60000 },
    ).allow("search"),
    false,
  );
  assert.equal(called, false);
});
test("distributed outage cannot fall back to local even across repeated calls", async () => {
  let calls = 0;
  const limiter = createRequestLimiter(
    validateEnvironment(configured),
    async () => {
      calls++;
      return new Response(null, { status: 503 });
    },
  );
  for (let i = 0; i < 3; i++)
    assert.equal(await limiter.allow("search"), false);
  assert.equal(calls, 3);
});
test("readiness requires flight, affiliate, fare store and Redis with AI off", () => {
  assert.deepEqual(configurationReadiness(validateEnvironment(configured)), {
    ready: true,
    blockers: [],
  });
  for (const [field, blocker] of [
    ["TRAVELPAYOUTS_API_TOKEN", "flight-provider"],
    ["TRAVELPAYOUTS_PROJECT_ID", "affiliate-provider"],
    ["TRAVELPAYOUTS_MARKER", "affiliate-provider"],
    ["RATE_LIMIT_REDIS_REST_TOKEN", "distributed-rate-limit"],
    ["DATABASE_URL", "fare-store"],
  ]) {
    const result = configurationReadiness(
      validateEnvironment({ ...configured, [field]: "" }),
    );
    assert.equal(result.ready, false);
    assert.ok(result.blockers.includes(blocker));
  }
  const invalid = validateEnvironment({
    ...configured,
    OPENAI_MODEL: "unsafe model",
    GOEKSPLO_LOG_LEVEL: "trace-secret",
  });
  assert.equal(invalid.capabilities.ai, false);
  assert.ok(
    configurationReadiness(invalid).blockers.includes("malformed-environment"),
  );
  assert.ok(
    validateEnvironment({
      ...configured,
      TRAVELPAYOUTS_API_TOKEN: "x",
    }).invalid.includes("TRAVELPAYOUTS_API_TOKEN"),
  );
});
test("configured runtime retains unresolved sign-offs while retiring superseded blockers", () => {
  const legal = legalPlaceholderReport();
  assert.deepEqual(legal.documents, []);
  const report = launchReadiness(
    validateEnvironment(configured),
    undefined,
    undefined,
    new Date("2026-11-20T12:00:00Z"),
  );
  assert.equal(report.ready, false);
  assert.equal(
    productionVerificationExitCode({ ...report, security: "passed" }, true),
    1,
  );
  assert.equal(
    productionVerificationExitCode({ ...report, security: "passed" }, false),
    0,
  );
  assert.deepEqual(report.configuration, []);
  assert.equal(
    report.manual.includes("historical-openai-revocation-unconfirmed"),
    false,
  );
  assert.ok(report.manual.includes("legal-review-pending"));
  assert.equal(report.manual.includes("production-host-tls-unverified"), false);
  assert.ok(report.manual.includes("fare-coverage-streak-unverified"));
  assert.ok(report.manual.includes("contact-mailbox-unverified"));
  const serialized = JSON.stringify(report);
  for (const value of [secret, "fixture.upstash.io", "123", "456"])
    assert.equal(serialized.includes(value), false);
  // Removing text placeholders is not an attestation of legal review or rotation.
  assert.equal(
    launchReadiness(validateEnvironment(configured), {
      pending: false,
      documents: [],
    }).ready,
    false,
  );
});
test("offline limiter diagnostic is keyless and the live check is isolated, bounded and validates TTL/reset", async () => {
  const result = await offlineRateLimitCheck();
  assert.equal(result.status, "passed");
  assert.equal(result.externalCalls, 0);
  const redis = fakeRedis();
  const live = await liveRateLimitCheck(
    validateEnvironment(configured),
    redis.fetcher,
    async (ms) => redis.advance(ms),
  );
  assert.equal(live.status, "passed");
  assert.equal(live.requests, 16);
  assert.ok(
    redis.commands.every((c) =>
      /^goeksplo:v2:production:diagnostic:[a-f0-9]{32}:limit:ai-intent$/.test(
        c[c[0] === "PTTL" ? 1 : 3],
      ),
    ),
  );
  assert.equal(
    new Set(redis.commands.map((c) => c[c[0] === "PTTL" ? 1 : 3])).size,
    1,
  );
  assert.equal(JSON.stringify(live).includes(secret), false);
  assert.equal(
    (await liveRateLimitCheck(validateEnvironment({}), noFetch)).requests,
    0,
  );
  const failed = await liveRateLimitCheck(
    validateEnvironment(configured),
    async () => {
      throw Error(secret);
    },
  );
  assert.equal(failed.status, "blocked");
  assert.equal(JSON.stringify(failed).includes(secret), false);
});
async function withProductionWithoutRedis(run: () => Promise<void>) {
  const keys = [
    ...Object.keys(configured),
    "OPENAI_API_KEY",
    "PEXELS_API_KEY",
    "GOEKSPLO_LOG_LEVEL",
  ];
  const old = new Map(keys.map((k) => [k, process.env[k]]));
  const fetcher = globalThis.fetch;
  Object.assign(process.env, configured, {
    RATE_LIMIT_REDIS_REST_URL: "",
    RATE_LIMIT_REDIS_REST_TOKEN: "",
    OPENAI_API_KEY: secret,
    PEXELS_API_KEY: secret,
    GOEKSPLO_LOG_LEVEL: "off",
  });
  let externalCalls = 0;
  globalThis.fetch = async () => {
    externalCalls++;
    throw Error("External fetch forbidden");
  };
  try {
    await run();
    assert.equal(externalCalls, 0);
  } finally {
    globalThis.fetch = fetcher;
    for (const [key, value] of old)
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
}
test("liveness stays 200; readiness separately fails closed without network, caching or private values", async () => {
  await withProductionWithoutRedis(async () => {
    const liveness = await health(),
      readiness = await ready();
    assert.equal(liveness.status, 200);
    assert.equal((await liveness.json()).status, "ok");
    assert.equal(readiness.status, 503);
    assert.equal(readiness.headers.get("cache-control"), "no-store");
    assert.match(readiness.headers.get("x-robots-tag")!, /noindex/);
    const raw = await readiness.text(),
      body = JSON.parse(raw);
    assert.deepEqual(Object.keys(body), ["status", "blockers"]);
    assert.ok(body.blockers.includes("distributed-rate-limit"));
    assert.equal(raw.includes(secret), false);
  });
});
test("production denial reports no flight outage for domestic searches and blocks editorial image-provider work", async (t) => {
  const nextCache = createRequire(__filename)("next/cache");
  t.mock.method(
    nextCache,
    "unstable_cache",
    (callback: () => unknown) => callback,
  );
  await withProductionWithoutRedis(async () => {
    const result = await getAppTripTemplates({
      ...defaultRequest,
      scope: "domestic",
    });
    // No demo road trips in production (2026-10-27).
    assert.ok(result.templates.every((t) => t.transport.mode !== "road"));
    assert.equal(
      result.issues.some((i) => i.destinationId === "flight-discovery"),
      false,
    );
    const demo = await getDemoImageTemplates(defaultRequest);
    assert.ok(demo.templates.length > 0);
    assert.ok(
      demo.templates.every((t) => t.destination.image?.source !== "provider"),
    );
    const inspiration = await getDemoImageTemplates(defaultRequest, [
      "prizren",
      "ohrid",
      "crete",
    ]);
    assert.deepEqual(
      inspiration.templates.map((t) => t.id),
      ["prizren", "ohrid"],
    );
    // Keep the historical unpriced-flight regression without republishing Crete.
    const historical = await getTripTemplates(
      defaultRequest,
      demoProviders,
      "crete",
    );
    const flight = pricePlan(historical.templates[0], defaultRequest);
    assert.equal(flight.pricingCompleteness, "flight-unpriced");
    assert.equal(
      flight.budget,
      undefined,
      "inspiration must not invent a complete flight trip price",
    );
  });
});

test("Upstash's default variable names are reported by name, never silently accepted", () => {
  const {
    RATE_LIMIT_REDIS_REST_URL: url,
    RATE_LIMIT_REDIS_REST_TOKEN: token,
    ...rest
  } = configured;
  const env = validateEnvironment({
    ...rest,
    UPSTASH_REDIS_REST_URL: url,
    UPSTASH_REDIS_REST_TOKEN: token,
  });
  // Not read under the Upstash names: production has no Redis and fails closed.
  assert.equal(env.redis, undefined);
  assert.equal(env.limiter, "required-but-unavailable");
  assert.deepEqual(env.misnamed, [
    { found: "UPSTASH_REDIS_REST_URL", expected: "RATE_LIMIT_REDIS_REST_URL" },
    {
      found: "UPSTASH_REDIS_REST_TOKEN",
      expected: "RATE_LIMIT_REDIS_REST_TOKEN",
    },
  ]);
  const errors = startupConfigurationErrors(env);
  assert.equal(errors.length, 2);
  assert.match(
    errors[0],
    /UPSTASH_REDIS_REST_URL is set but RATE_LIMIT_REDIS_REST_URL is not/,
  );
  assert.ok(
    errors.every((e) => !e.includes(url) && !e.includes(token)),
    "no values in messages",
  );
  assert.ok(
    configurationReport(env).blockers.includes(
      "Found UPSTASH_REDIS_REST_URL, expected RATE_LIMIT_REDIS_REST_URL: rename it (Upstash's default name is not read)",
    ),
  );
  assert.ok(
    configurationReadiness(env).blockers.includes("malformed-environment"),
  );
  // The right names: nothing to report, Redis configured.
  const right = validateEnvironment(configured);
  assert.deepEqual(right.misnamed, []);
  assert.equal(right.limiter, "distributed");
  // Both present: the expected name wins and nothing is reported.
  assert.deepEqual(
    validateEnvironment({ ...configured, UPSTASH_REDIS_REST_URL: url })
      .misnamed,
    [],
  );
  // Locally the limiter policy is unchanged (still local), only reported.
  const local = validateEnvironment({ UPSTASH_REDIS_REST_URL: url });
  assert.equal(local.limiter, "local");
  assert.equal(local.misnamed.length, 1);
});
