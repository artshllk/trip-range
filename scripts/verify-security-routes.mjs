import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3110";
assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
let env = {};
try {
  env = parseEnv(readFileSync(".env.local", "utf8"));
} catch {}
const secrets = [
  "OPENAI_API_KEY",
  "TRAVELPAYOUTS_API_TOKEN",
  "PEXELS_API_KEY",
  "RATE_LIMIT_REDIS_REST_TOKEN",
]
  .map((k) => env[k])
  .filter((v) => v && v.length >= 8);
function clean(body) {
  assert.equal(
    secrets.some((s) => body.includes(s)),
    false,
    "Private credential found; content withheld",
  );
}
for (const path of [
  "/api/health",
  "/",
  "/plan/results?scope=domestic&budget=300",
  "/plan/trips/prizren?scope=domestic&budget=300",
  "/privacy",
  "/sq/terms",
  "/sq/affiliate-disclosure",
  "/from/zurich",
  "/from/zurich/weekend-trips",
  "/from/zurich/weekend-trips-under-500",
  "/sitemap.xml",
]) {
  const r = await fetch(origin + path);
  assert.equal(r.status, 200, path);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.ok(
    r.headers
      .get("content-security-policy")
      ?.includes("frame-ancestors 'none'"),
  );
  const text = await r.text();
  clean(text);
  if (path === "/api/health") {
    assert.deepEqual(Object.keys(JSON.parse(text)).sort(), [
      "capabilities",
      "status",
      "version",
    ]);
    assert.equal(r.headers.get("cache-control"), "no-store");
  }
  if (path === "/")
    for (const js of new Set(
      [...text.matchAll(/src="([^" ]+\.js[^" ]*)"/g)].map((m) => m[1]),
    )) {
      const body = await (await fetch(new URL(js, origin))).text();
      clean(body);
    }
}
const ready = await fetch(origin + "/api/ready");
assert.equal(ready.status, 503, "manual launch blockers remain");
assert.equal(ready.headers.get("cache-control"), "no-store");
assert.match(ready.headers.get("x-robots-tag"), /noindex/);
const readinessText = await ready.text();
clean(readinessText);
const readiness = JSON.parse(readinessText);
assert.deepEqual(Object.keys(readiness).sort(), ["blockers", "status"]);
assert.ok(readiness.blockers.includes("legal-review-pending"));
assert.ok(
  readiness.blockers.includes("fare-coverage-streak-unverified"),
);
const rsc = await fetch(origin + "/plan/results?scope=domestic", {
  headers: { RSC: "1" },
});
assert.equal(rsc.status, 200);
clean(await rsc.text());
for (const [path, options, status] of [
  ["/api/locations?q=x&q=y", {}, 400],
  ["/api/locations?q=" + "a".repeat(500), {}, 400],
  ["/api/locations", { method: "POST" }, 405],
  ["/api/ai/intent", { method: "GET" }, 405],
  [
    "/api/ai/intent",
    {
      method: "POST",
      headers: {
        origin: "https://other.invalid",
        "content-type": "application/json",
      },
      body: "{}",
    },
    400,
  ],
  ["/api/affiliate/flights", { method: "GET" }, 405],
  [
    "/api/affiliate/flights",
    {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: '{"padding":"' + "x".repeat(2200) + '"}',
    },
    400,
  ],
]) {
  const response = await fetch(origin + path, options);
  assert.equal(response.status, status);
  clean(await response.text());
}
const https = await fetch(origin + "/api/health", {
  headers: { "x-forwarded-proto": "https" },
});
assert.equal(
  https.headers.get("strict-transport-security"),
  "max-age=31536000",
);
if (process.env.VERIFY_LOG_PATH)
  clean(readFileSync(process.env.VERIFY_LOG_PATH, "utf8"));
console.log(
  "PASS production headers, health, HTML/RSC/client JS secret boundaries, legal routes and malformed API requests",
);
