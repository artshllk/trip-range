/** Read-only local endpoint acceptance. Use a production-mode server with synthetic provider keys and no Redis. */
import assert from "node:assert/strict";
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3114";
assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
const health = await fetch(origin + "/api/health");
assert.equal(health.status, 200);
assert.equal((await health.json()).status, "ok");
const ready = await fetch(origin + "/api/ready");
assert.equal(ready.status, 503);
assert.equal(ready.headers.get("cache-control"), "no-store");
assert.match(ready.headers.get("x-robots-tag"), /noindex/);
const report = await ready.json();
assert.ok(report.blockers.includes("distributed-rate-limit"));
assert.ok(report.blockers.includes("fare-coverage-streak-unverified"));
for (const path of [
  "/api/locations?q=Vienna",
  "/api/affiliate/flights",
  "/api/ai/intent",
]) {
  const response = await fetch(
    origin + path,
    path.includes("locations")
      ? {}
      : {
          method: "POST",
          headers: { origin, "Content-Type": "application/json" },
          body: "{}",
        },
  );
  assert.equal(response.status, 429, "operation must fail closed");
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.status, "unavailable");
  assert.deepEqual(
    Object.keys(body).sort(),
    path.includes("locations") ? ["locations", "status"] : ["status"],
  );
}
for (const path of [
  "/",
  "/sq",
  "/plan/results?origin=prishtina&scope=domestic&budget=300",
  "/plan/trips/prizren?origin=prishtina&scope=domestic&budget=300",
]) {
  const response = await fetch(origin + path);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(text.includes("<main"));
  assert.equal(
    /synthetic-server-credential|fixture\.upstash\.io/.test(text),
    false,
  );
}
console.log(
  "PASS liveness 200, launch readiness 503, production missing-Redis denial for protected APIs, EN/SQ and domestic fallback pages",
);
