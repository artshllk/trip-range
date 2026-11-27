import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deploymentMode,
  netlifyBuildContext,
  vercelAnalyticsEnabled,
} from "../src/config/deployment";
import { validateEnvironment } from "../src/config/environment";
import { configurationReadiness } from "../src/config/readiness";
import {
  deploymentIndexingHeaders,
  securityHeaders,
} from "../src/config/security";
import { createRequestLimiter, limits } from "../src/server/rate-limit";
import { readAiBody } from "../src/services/ai/request-guard";
import { handleFlightAffiliate } from "../src/services/affiliate-handoff";
import { createOpenAiIntent } from "../src/providers/server/ai/openai";
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const site = "00000000-0000-4000-8000-000000000001";
const credential = "synthetic-netlify-test-value";
const build = (context: string) => ({
  NETLIFY: "true",
  CONTEXT: context,
  GOEKSPLO_NETLIFY_CONTEXT: context,
});
const runtime = (context: string) => ({
  SITE_ID: site,
  GOEKSPLO_NETLIFY_CONTEXT: context,
});
test("Netlify build and Functions classification overrides NODE_ENV/CI consistently", () => {
  for (const signals of [build, runtime])
    for (const context of ["production", "deploy-preview", "branch-deploy"])
      for (const node of ["production", "test", "development", undefined]) {
        const env = { ...signals(context), NODE_ENV: node, CI: "true" };
        const expected = context === "production" ? "production" : "preview";
        assert.equal(deploymentMode(env), expected);
        const config = validateEnvironment(env);
        assert.equal(config.mode, expected);
        assert.equal(config.deployed, true);
        assert.equal(config.production, true);
        assert.equal(config.limiterNamespace, `goeksplo:v2:${expected}`);
        assert.equal(config.vercelAnalytics, false);
        if (expected === "preview")
          assert.deepEqual(deploymentIndexingHeaders(config.mode), [
            { key: "X-Robots-Tag", value: "noindex, nofollow" },
          ]);
      }
});
test("incomplete, conflicting and malformed Netlify signals fail closed", () => {
  const cases = [
    { NETLIFY: "true" },
    { CONTEXT: "production" },
    { SITE_ID: site },
    { GOEKSPLO_NETLIFY_CONTEXT: "production" },
    { ...build("production"), GOEKSPLO_NETLIFY_CONTEXT: undefined },
    { ...build("production"), GOEKSPLO_NETLIFY_CONTEXT: "deploy-preview" },
    { ...build("deploy-preview"), GOEKSPLO_NETLIFY_CONTEXT: "production" },
    { ...build("production"), NETLIFY: "false" },
    { ...build("production"), NETLIFY: "1" },
    { ...build("production"), NETLIFY_DEV: "true" },
    { ...runtime("production"), SITE_ID: " " },
    { ...runtime("production"), VERCEL: "1", VERCEL_ENV: "production" },
    { ...build("production"), VERCEL_ENV: "development" },
    { NETLIFY: "" },
    ...["", "unknown", "test", "local", "preview", "production "].map(build),
    build("dev"),
    runtime("dev"),
    { ...build("production"), NETLIFY_DEV: "false" },
  ];
  for (const signals of cases) {
    const env = validateEnvironment({
      ...signals,
      NODE_ENV: "test",
      CI: "true",
    });
    assert.equal(env.mode, "invalid", JSON.stringify(signals));
    assert.ok(env.invalid.includes("DEPLOYMENT_CONFIGURATION"));
    assert.equal(env.limiter, "required-but-unavailable");
    assert.equal(vercelAnalyticsEnabled(signals), false);
    assert.equal(
      deploymentIndexingHeaders(env.mode)[0].value,
      "noindex, nofollow",
    );
  }
  assert.equal(
    deploymentMode({ ...build("dev"), NETLIFY_DEV: "true" }),
    "local",
  );
  assert.equal(deploymentMode({}), "local");
  assert.equal(deploymentMode({ CI: "true" }), "test");
});
test("Netlify production requires Redis, credentialed previews do too; no local fallback", async () => {
  for (const context of ["production", "deploy-preview", "branch-deploy"])
    for (const signals of [build(context), runtime(context)]) {
      const keyless = validateEnvironment(signals);
      assert.equal(
        keyless.limiter,
        context === "production" ? "required-but-unavailable" : "local",
      );
      for (const key of [
        "OPENAI_API_KEY",
        "TRAVELPAYOUTS_API_TOKEN",
        "PEXELS_API_KEY",
      ]) {
        const config = validateEnvironment({ ...signals, [key]: credential });
        assert.equal(config.limiter, "required-but-unavailable");
        const limiter = createRequestLimiter(config, async () => {
          assert.fail(
            "Missing Redis must never call a provider or choose a local limiter",
          );
        });
        for (const op of Object.keys(limits) as (keyof typeof limits)[])
          assert.equal(await limiter.allow(op), false);
      }
      const configured = validateEnvironment({
        ...signals,
        TRAVELPAYOUTS_API_TOKEN: credential,
        TRAVELPAYOUTS_PROJECT_ID: "123",
        TRAVELPAYOUTS_MARKER: "456",
        RATE_LIMIT_REDIS_REST_URL: "https://fixture.upstash.io",
        RATE_LIMIT_REDIS_REST_TOKEN: credential,
      });
      assert.equal(configured.limiter, "distributed");
      assert.deepEqual(configurationReadiness(configured).blockers, [
        "fare-store",
      ]);
      const commands: string[][] = [];
      const limiter = createRequestLimiter(configured, async (_url, init) => {
        commands.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 503 });
      });
      assert.equal(await limiter.allow("search"), false);
      assert.equal(await limiter.allow("search"), false);
      assert.equal(commands.length, 2);
      assert.equal(
        commands[0][3],
        `${configured.limiterNamespace}:limit:search`,
      );
    }
});
test("Netlify deployed fixtures remain forbidden and CSP keeps its existing restrictions", () => {
  for (const context of ["production", "deploy-preview", "branch-deploy"])
    for (const signals of [build(context), runtime(context)]) {
      const env = validateEnvironment({ ...signals, GOEKSPLO_AI_FIXTURE: "1" });
      assert.ok(env.invalid.includes("TEST_FIXTURE_CONFIGURATION"));
    }
  const csp = securityHeaders(true).find(
    (h) => h.key === "Content-Security-Policy",
  )!.value;
  assert.ok(!csp.includes("unsafe-eval"));
  assert.ok(csp.includes("frame-ancestors 'none'"));
  assert.ok(csp.includes("form-action 'self'"));
});
test("immutable Netlify build identity rejects runtime drift and keeps every protected operation closed", async () => {
  for (const built of ["production", "deploy-preview", "branch-deploy"])
    for (const current of [
      "production",
      "deploy-preview",
      "branch-deploy",
      "",
      "malformed",
      undefined,
    ]) {
      const env = validateEnvironment(
        {
          SITE_ID: site,
          GOEKSPLO_NETLIFY_CONTEXT: current,
          NODE_ENV: "test",
          CI: "true",
        },
        built,
      );
      const matching = built === current;
      assert.equal(
        env.mode,
        matching
          ? built === "production"
            ? "production"
            : "preview"
          : "invalid",
      );
      assert.equal(env.production, true);
      let calls = 0;
      const limiter = createRequestLimiter(env, async () => {
        calls++;
        throw Error("No Redis configured");
      });
      for (const op of Object.keys(limits) as (keyof typeof limits)[])
        assert.equal(
          await limiter.allow(op),
          matching && built !== "production",
        );
      assert.equal(calls, 0);
    }
  for (const signals of [
    {},
    { VERCEL: "1", VERCEL_ENV: "production" },
    runtime("production"),
  ]) {
    const env = validateEnvironment(signals, "");
    assert.equal(
      env.mode,
      "SITE_ID" in signals
        ? "invalid"
        : "VERCEL" in signals
          ? "production"
          : "local",
    );
  }
  assert.equal(
    validateEnvironment({ VERCEL: "1", VERCEL_ENV: "production" }, "production")
      .vercelAnalytics,
    false,
  );
  assert.equal(
    validateEnvironment(runtime("production"), "malformed").limiter,
    "required-but-unavailable",
  );
});
test("only a validated native Netlify build context can become the bundled identity", () => {
  for (const context of ["production", "deploy-preview", "branch-deploy"])
    assert.equal(netlifyBuildContext(build(context)), context);
  assert.equal(
    netlifyBuildContext({ ...build("dev"), NETLIFY_DEV: "true" }),
    "dev",
  );
  assert.equal(netlifyBuildContext({ CI: "true" }), "");
  assert.equal(
    netlifyBuildContext({ VERCEL: "1", VERCEL_ENV: "production" }),
    "",
  );
  for (const env of [
    runtime("production"),
    { NETLIFY: "true" },
    build("malformed"),
    { ...build("production"), GOEKSPLO_NETLIFY_CONTEXT: "deploy-preview" },
  ])
    assert.throws(
      () => netlifyBuildContext(env),
      /Invalid Netlify build context/,
    );
});
test("deployed fixture indicators disable provider capabilities and credentials even with working Redis", async () => {
  for (const signals of [
    build("production"),
    runtime("deploy-preview"),
    { VERCEL: "1", VERCEL_ENV: "production" },
    { VERCEL: "1", VERCEL_ENV: "preview" },
  ])
    for (const flag of [
      "GOEKSPLO_AI_FIXTURE",
      "GOEKSPLO_PRICING_FIXTURE",
      "GOEKSPLO_UNKNOWN_FIXTURE",
    ]) {
      const env = validateEnvironment({
        ...signals,
        [flag]: "1",
        GOEKSPLO_AI_ENABLED: "true",
        OPENAI_API_KEY: credential,
        TRAVELPAYOUTS_API_TOKEN: credential,
        TRAVELPAYOUTS_PROJECT_ID: "123",
        TRAVELPAYOUTS_MARKER: "456",
        PEXELS_API_KEY: credential,
        RATE_LIMIT_REDIS_REST_URL: "https://fixture.upstash.io",
        RATE_LIMIT_REDIS_REST_TOKEN: credential,
      });
      assert.ok(Object.values(env.capabilities).every((value) => !value));
      assert.equal(env.ai.apiKey, undefined);
      assert.equal(env.pexelsKey, undefined);
      assert.ok(
        Object.values(env.travelpayouts).every((value) => value === undefined),
      );
      const limiter = createRequestLimiter(env, async () => {
        assert.fail(
          "Forbidden fixture configuration must not even contact Redis",
        );
      });
      for (const op of Object.keys(limits) as (keyof typeof limits)[])
        assert.equal(await limiter.allow(op), false);
      assert.equal(
        (
          await createOpenAiIntent(env.ai, async () => {
            assert.fail("Forbidden fixture AI must not fetch");
          }).parse({ text: "A weekend trip", locale: "en" })
        ).status,
        "unavailable",
      );
    }
  const local = validateEnvironment({
    CI: "true",
    GOEKSPLO_AI_FIXTURE: "1",
    GOEKSPLO_AI_ENABLED: "true",
    OPENAI_API_KEY: credential,
  });
  assert.equal(local.capabilities.ai, true);
  assert.equal(await createRequestLimiter(local).allow("ai-intent"), true);
});
for (const entry of readdirSync("scripts/fixtures").filter(
  (name) => name.endsWith(".mjs") && name !== "guard.mjs",
)) {
  test(`${entry}: deployed preload rejects before modifying fetch`, () => {
    for (const signals of [
      build("production"),
      runtime("deploy-preview"),
      { VERCEL: "1", VERCEL_ENV: "production" },
      { VERCEL: "1", VERCEL_ENV: "preview" },
    ]) {
      const child = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
        const before = globalThis.fetch;
        try { await import(${JSON.stringify(pathToFileURL(resolve("scripts/fixtures", entry)).href)}); process.exit(2); }
        catch (error) { if (error.message !== "Local fixtures are forbidden on deployed environments" || globalThis.fetch !== before) process.exit(3); }
      `,
        ],
        {
          env: {
            PATH: process.env.PATH,
            NODE_OPTIONS: process.env.NODE_OPTIONS,
            NODE_ENV: "test",
            ...signals,
            GOEKSPLO_AI_FIXTURE: "1",
          },
          encoding: "utf8",
          timeout: 5000,
        },
      );
      assert.equal(child.status, 0, `${entry}: ${child.stderr}`);
    }
  });
}
test("local and CI AI fixture preload still works without any network", () => {
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    const before = globalThis.fetch;
    await import(${JSON.stringify(pathToFileURL(resolve("scripts/fixtures/ai.mjs")).href)});
    if (globalThis.fetch === before) process.exit(2);
    const r = await fetch("https://api.openai.com/v1/responses", { body: JSON.stringify({ input: JSON.stringify({text:"A weekend trip",locale:"en"}), text:{format:{name:"travel_intent"}} }) });
    if (r.status !== 200) process.exit(3);
  `,
    ],
    {
      env: {
        PATH: process.env.PATH,
        NODE_OPTIONS: process.env.NODE_OPTIONS,
        NODE_ENV: "test",
        CI: "true",
        GOEKSPLO_AI_FIXTURE: "1",
      },
      encoding: "utf8",
      timeout: 5000,
    },
  );
  assert.equal(child.status, 0, child.stderr);
});
test("Vercel analytics remains available only on validated Vercel deployments", () => {
  for (const target of ["production", "preview", "development"])
    assert.equal(
      vercelAnalyticsEnabled({ VERCEL: "1", VERCEL_ENV: target }),
      true,
    );
  for (const env of [
    {},
    { NODE_ENV: "production" },
    { VERCEL: "1" },
    build("production"),
    runtime("production"),
  ])
    assert.equal(vercelAnalyticsEnabled(env), false);
});
test("AI remains direct and optional; injected Gateway configuration cannot enable it", async () => {
  assert.equal(
    validateEnvironment({
      VERCEL: "1",
      VERCEL_ENV: "production",
      GOEKSPLO_AI_ENABLED: "true",
      OPENAI_API_KEY: credential,
      OPENAI_BASE_URL: "https://unused.example.invalid",
    }).capabilities.ai,
    true,
    "preserve existing Vercel direct-API behavior",
  );
  for (const signals of [build("deploy-preview"), runtime("production")]) {
    assert.equal(validateEnvironment(signals).capabilities.ai, false);
    const gateway = validateEnvironment({
      ...signals,
      GOEKSPLO_AI_ENABLED: "true",
      OPENAI_API_KEY: credential,
      OPENAI_BASE_URL: "https://gateway.example.invalid/v1",
    });
    assert.equal(gateway.capabilities.ai, false);
    assert.equal(gateway.ai.apiKey, undefined);
    assert.equal(
      validateEnvironment({
        ...signals,
        GOEKSPLO_AI_ENABLED: "true",
        OPENAI_API_KEY: credential,
      }).capabilities.ai,
      true,
    );
  }
  const result = await createOpenAiIntent({}, async () => {
    assert.fail("Missing API key must never perform an OpenAI request");
  }).parse({ text: "A weekend trip", locale: "en" });
  assert.deepEqual(result, { status: "unavailable", reason: "configuration" });
});
test("Netlify HTTPS request origins must match Host; forwarded headers cannot grant access", async () => {
  const url = "https://deploy-preview-1--goeksplo.netlify.app/api/ai/intent";
  for (const origin of [
    "https://attacker.invalid",
    "http://deploy-preview-1--goeksplo.netlify.app",
  ])
    assert.equal(
      await readAiBody(
        new Request(url, {
          method: "POST",
          headers: {
            origin,
            host: "deploy-preview-1--goeksplo.netlify.app",
            "content-type": "application/json",
            "x-forwarded-host": "attacker.invalid",
            "x-forwarded-proto": "https",
          },
          body: "{}",
        }),
      ),
      undefined,
    );
  assert.deepEqual(
    await readAiBody(
      new Request(url, {
        method: "POST",
        headers: {
          origin: new URL(url).origin,
          "content-type": "application/json",
        },
        body: "{}",
      }),
    ),
    {},
  );
  let calls = 0;
  const response = await handleFlightAffiliate(
    new Request(url.replace("ai/intent", "affiliate/flights"), {
      method: "POST",
      headers: {
        origin: "https://attacker.invalid",
        "content-type": "application/json",
      },
      body: "{}",
    }),
    {
      async createLink() {
        calls++;
        return { status: "unavailable", reason: "provider" };
      },
    },
  );
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});
