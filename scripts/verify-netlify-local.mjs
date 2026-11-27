/** Acceptance checks for an already-running, keyless Netlify offline preview.
 * Localhost only; never starts a server, loads .env files or calls a provider.
 */
import assert from "node:assert/strict";
const origin = process.env.VERIFY_ORIGIN || "http://localhost:3217";
assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
const request = (path, init) =>
  fetch(origin + path, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
const pages = [
  "/",
  "/sq",
  "/plan/results?scope=domestic&budget=300",
  "/sq/plan/results?scope=domestic&budget=300",
  "/plan/trips/prizren?scope=domestic&budget=300",
  "/sq/plan/trips/prizren?scope=domestic&budget=300",
  "/privacy",
  "/sq/terms",
];
const poweredBy = new Set();
for (const path of pages) {
  const response = await request(path);
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get("x-robots-tag"), /noindex/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  if (response.headers.get("x-powered-by"))
    poweredBy.add(response.headers.get("x-powered-by"));
  const policy = response.headers.get("content-security-policy");
  assert.ok(policy.includes("frame-ancestors 'none'"));
  assert.ok(!policy.includes("unsafe-eval"));
  const html = await response.text();
  if (!path.includes("/plan/"))
    assert.deepEqual(
      [...html.matchAll(/<link rel="canonical" href="([^"]+)"/g)].map(
        (m) => m[1],
      ),
      ["https://www.trip-range.com" + path],
    );
  assert.match(html, new RegExp(`<html[^>]*lang="${path.slice(1, 3)}"`));
  assert.ok(html.includes("<main"));
  if (path.includes("/plan/"))
    assert.match(html, /name="robots" content="noindex, follow"/);
}
const root = await request("/");
assert.equal(root.status, 307);
assert.equal(root.headers.get("location"), "/");
const invalid = await request("/de");
assert.equal(invalid.status, 404);
assert.match(invalid.headers.get("x-robots-tag"), /noindex/);
const health = await request("/api/health");
assert.equal(health.status, 200);
assert.equal(health.headers.get("cache-control"), "no-store");
const capabilities = (await health.json()).capabilities;
for (const key of ["ai", "flights", "affiliate", "pexels"])
  assert.equal(capabilities[key], false);
const ready = await request("/api/ready");
assert.equal(ready.status, 503); // Manual launch checks remain intentionally unresolved.
assert.equal(ready.headers.get("cache-control"), "no-store");
const robots = await request("/robots.txt");
assert.equal(robots.status, 200);
assert.match(robots.headers.get("x-robots-tag"), /noindex/);
assert.match(
  await robots.text(),
  /Sitemap: https:\/\/www\.trip-range\.com\/sitemap.xml/,
);
const sitemaps = [];
for (let i = 0; i < 2; i++) {
  const sitemap = await request("/sitemap.xml");
  assert.equal(sitemap.status, 200);
  assert.match(sitemap.headers.get("x-robots-tag"), /noindex/);
  const xml = await sitemap.text();
  assert.ok(!xml.includes("/plan/") && !xml.includes("netlify.app"));
  assert.ok(
    [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].every((m) =>
      m[1].startsWith("https://www.trip-range.com/"),
    ),
  );
  sitemaps.push(xml);
}
assert.equal(
  sitemaps[0],
  sitemaps[1],
  "same approved publication snapshot on repeated reads",
);
const post = (path, source, body) =>
  request(path, {
    method: "POST",
    headers: {
      origin: source,
      "content-type": "application/json",
      "sec-fetch-site": source === origin ? "same-origin" : "cross-site",
    },
    body: JSON.stringify(body),
  });
for (const path of ["/api/ai/intent", "/api/affiliate/flights"]) {
  const response = await post(path, "https://attacker.invalid", {});
  assert.equal(response.status, 400, path + " rejects cross-origin POST");
  assert.equal(response.headers.get("cache-control"), "no-store");
}
const ai = await post("/api/ai/intent", origin, {
  text: "A weekend trip",
  locale: "en",
  draft: {},
});
assert.equal(
  ai.status,
  200,
  "same-origin AI POST reaches the keyless fallback",
);
assert.equal((await ai.json()).status, "unavailable");
assert.equal(ai.headers.get("cache-control"), "no-store");
const affiliate = await post("/api/affiliate/flights", origin, {});
assert.equal(
  affiliate.status,
  400,
  "same-origin affiliate POST reaches body validation",
);
console.log(
  "PASS Netlify offline SSR, EN/SQ results/detail, redirects/404, CSP, preview noindex, canonical sitemap/robots, stable repeated sitemap, APIs and POST origin boundaries; AI key absent.",
);
// Keep this check strict. Netlify CLI may add Express's header itself; record
// that emulator limitation instead of silently claiming the hosted check passed.
assert.equal(
  poweredBy.size,
  0,
  `Unexpected X-Powered-By: ${[...poweredBy].join(", ")}`,
);
