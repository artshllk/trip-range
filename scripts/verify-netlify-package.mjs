/** Offline acceptance of an extracted official Netlify server-handler ZIP.
 * NETLIFY_PACKAGE_DIR must contain ___netlify-server-handler.mjs and run-config.json.
 * Every case starts with an allowlisted environment. All fetches are intercepted;
 * only synthetic Redis/Blobs replies exist. No listener, account or provider calls.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const site = "00000000-0000-4000-8000-000000000001";
const synthetic = "synthetic-package-test-value";
const origin = "https://offline.example.invalid";

async function probe({
  directory,
  built,
  signals,
  redis,
  fixtures,
  allowed,
  namespace,
}) {
  const commands = [],
    unexpected = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (url.hostname === "fixture.upstash.io") {
      commands.push(JSON.parse(String(init.body)));
      return redis === "failure"
        ? new Response(null, { status: 503 })
        : Response.json({ result: 1 });
    }
    if (url.origin === "http://127.0.0.1:33330")
      return new Response(null, { status: 404 });
    unexpected.push(url.hostname);
    throw Error("Offline package probe forbids external fetch");
  };
  globalThis.netlifyBlobsContext = Buffer.from(
    JSON.stringify({
      siteID: site,
      deployID: "000000000000000000000001",
      token: synthetic,
      apiURL: "http://127.0.0.1:33330",
      edgeURL: "http://127.0.0.1:33330",
      primaryRegion: "us-east-2",
    }),
  ).toString("base64");
  process.chdir(directory);
  const { default: handler } = await import(
    pathToFileURL(resolve(directory, "___netlify-server-handler.mjs")).href
  );
  const context = {
    account: { id: "offline" },
    deploy: { id: "000000000000000000000001" },
    site: { id: site },
    requestId: "offline",
    waitUntil: (p) => p.catch(() => {}),
  };
  const request = (path, body, source = origin) =>
    new Request(origin + path, {
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
      headers: {
        host: "offline.example.invalid",
        "x-forwarded-proto": "https",
        ...(body ? { origin: source, "content-type": "application/json" } : {}),
      },
    });
  const response = await handler(
    request("/api/ai/intent", {
      text: "A weekend trip",
      locale: "en",
      draft: {},
    }),
    context,
  );
  assert.equal(response.status, allowed ? 200 : 429);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-powered-by"), null);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(
    response.headers.get("strict-transport-security"),
    "max-age=31536000",
  );
  assert.ok(
    !response.headers.get("content-security-policy").includes("unsafe-eval"),
  );
  assert.equal((await response.json()).status, "unavailable");
  if (namespace) {
    assert.equal(commands.length, 1);
    assert.equal(commands[0][3], `goeksplo:v2:${namespace}:limit:ai-intent`);
  } else assert.equal(commands.length, 0);

  const health = await handler(request("/api/health"), context);
  assert.equal(health.status, 200);
  const healthText = await health.text();
  assert.ok(!healthText.includes(synthetic));
  if (fixtures)
    assert.ok(
      Object.values(JSON.parse(healthText).capabilities).every(
        (value) => !value,
      ),
    );

  // Check the actual built response policy, including during runtime drift.
  const home = await handler(request("/"), context);
  assert.equal(home.status, 200);
  assert.equal(home.headers.get("x-powered-by"), null);
  if (built !== "production")
    assert.match(home.headers.get("x-robots-tag"), /noindex, nofollow/);
  const html = await home.text();
  assert.ok(html.includes('lang="en"') && html.includes("<main"));
  assert.ok(!html.includes(synthetic));
  assert.match(html, /rel="canonical" href="https:\/\/goeksplo\.com\/"/);

  // Valid bodies isolate origin rejection from unrelated payload validation.
  const count = commands.length;
  for (const [path, body] of [
    ["/api/ai/intent", { text: "A weekend trip", locale: "en", draft: {} }],
    [
      "/api/affiliate/flights",
      {
        placement: "trip",
        route: {
          originCode: "ZRH",
          destinationCode: "VIE",
          departureDate: "2026-11-07",
          returnDate: "2026-11-09",
          party: { adults: 2, children: 0 },
        },
      },
    ],
  ]) {
    const bad = await handler(
      request(path, body, "https://attacker.invalid"),
      context,
    );
    // Affiliate's existing route-level limiter precedes its origin guard.
    assert.equal(
      bad.status,
      path.includes("affiliate") && !allowed ? 429 : 400,
    );
    assert.equal(bad.headers.get("cache-control"), "no-store");
    await bad.text();
  }
  assert.deepEqual(
    unexpected,
    [],
    "No external provider fetch may be attempted",
  );
  assert.equal(commands.length, count + (namespace ? 1 : 0));
  console.log(
    JSON.stringify({
      built,
      runtime: signals.GOEKSPLO_NETLIFY_CONTEXT ?? "absent",
      allowed,
      fixtures: !!fixtures,
      namespace: namespace ?? "none",
      directPoweredBy: "absent",
    }),
  );
}

if (process.argv[2] === "--case") {
  await probe(JSON.parse(readFileSync(0, "utf8")));
} else {
  assert.ok(
    process.env.NETLIFY_PACKAGE_DIR,
    "Set NETLIFY_PACKAGE_DIR to an extracted official function ZIP",
  );
  const directory = resolve(process.env.NETLIFY_PACKAGE_DIR);
  const config = JSON.parse(
    readFileSync(resolve(directory, "run-config.json"), "utf8"),
  );
  const built = config.nextConfig.env.GOEKSPLO_NETLIFY_BUILD_CONTEXT;
  assert.ok(["production", "deploy-preview", "branch-deploy"].includes(built));
  const matching = { SITE_ID: site, GOEKSPLO_NETLIFY_CONTEXT: built };
  const cases = [
    {
      name: "matching-keyless",
      signals: matching,
      allowed: built !== "production",
    },
    {
      name: "context-disagreement",
      signals: {
        ...matching,
        GOEKSPLO_NETLIFY_CONTEXT:
          built === "production" ? "deploy-preview" : "production",
      },
      allowed: false,
    },
    { name: "missing-context", signals: { SITE_ID: site }, allowed: false },
    {
      name: "malformed-context",
      signals: { ...matching, GOEKSPLO_NETLIFY_CONTEXT: "preview" },
      allowed: false,
    },
    {
      name: "contradictory-platforms",
      signals: { ...matching, VERCEL: "1", VERCEL_ENV: "production" },
      allowed: false,
    },
    { name: "missing-all-runtime-signals", signals: {}, allowed: false },
    {
      name: "runtime-dev-cannot-downgrade",
      signals: {
        ...matching,
        GOEKSPLO_NETLIFY_CONTEXT: "dev",
        CONTEXT: "dev",
        NETLIFY_DEV: "true",
      },
      allowed: false,
    },
    {
      name: "contradictory-native-context",
      signals: {
        ...matching,
        CONTEXT: built === "production" ? "deploy-preview" : "production",
      },
      allowed: false,
    },
    {
      name: "malformed-site",
      signals: { ...matching, SITE_ID: "invalid" },
      allowed: false,
    },
    {
      name: "runtime-cannot-replace-compiled-identity",
      signals: {
        ...matching,
        GOEKSPLO_NETLIFY_BUILD_CONTEXT:
          built === "production" ? "deploy-preview" : "production",
      },
      allowed: built !== "production",
    },
    {
      name: "coordinated-runtime-identity-spoof",
      signals: {
        ...matching,
        GOEKSPLO_NETLIFY_CONTEXT:
          built === "production" ? "deploy-preview" : "production",
        GOEKSPLO_NETLIFY_BUILD_CONTEXT:
          built === "production" ? "deploy-preview" : "production",
      },
      allowed: false,
    },
    {
      name: "working-redis",
      signals: matching,
      redis: "success",
      allowed: true,
      namespace: built === "production" ? "production" : "preview",
    },
    {
      name: "failing-redis",
      signals: matching,
      redis: "failure",
      allowed: false,
      namespace: built === "production" ? "production" : "preview",
    },
    {
      name: "context-disagreement-with-redis",
      signals: {
        ...matching,
        GOEKSPLO_NETLIFY_CONTEXT:
          built === "production" ? "deploy-preview" : "production",
      },
      redis: "success",
      allowed: false,
    },
    {
      name: "fixtures-with-openai-providers-and-redis",
      signals: matching,
      fixtures: true,
      redis: "success",
      allowed: false,
    },
  ];
  for (const entry of cases) {
    const env = {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      NODE_OPTIONS: process.env.NODE_OPTIONS,
      ...entry.signals,
      ...(entry.redis
        ? {
            RATE_LIMIT_REDIS_REST_URL: "https://fixture.upstash.io",
            RATE_LIMIT_REDIS_REST_TOKEN: synthetic,
          }
        : {}),
      ...(entry.fixtures
        ? {
            GOEKSPLO_AI_FIXTURE: "1",
            OPENAI_API_KEY: synthetic,
            TRAVELPAYOUTS_API_TOKEN: synthetic,
            TRAVELPAYOUTS_PROJECT_ID: "123",
            TRAVELPAYOUTS_MARKER: "456",
            PEXELS_API_KEY: synthetic,
          }
        : {}),
    };
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url), "--case"],
      {
        env,
        input: JSON.stringify({ directory, built, ...entry }),
        encoding: "utf8",
        timeout: 30000,
      },
    );
    assert.equal(
      result.status,
      0,
      `${entry.name}: ${result.stderr}\n${result.stdout}`,
    );
    console.log(`PASS ${built}: ${entry.name}`);
  }
  console.log(
    `PASS ${cases.length} packaged ${built} cases; direct handler headers verified, hosted CDN remains unverified.`,
  );
}
