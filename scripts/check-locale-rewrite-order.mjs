/** Netlify evaluates config redirects after the proxy's internal rewrite.
 * Check the built redirect manifest against actual proxy responses, so a rule
 * that passes standalone Next.js tests cannot reintroduce the hosted loop.
 * Run after npm test and npm run build, without credentials or network calls.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { NextRequest } = require("next/server");
const { proxy } = require("../.test-build/src/proxy.js");
const { redirects } = JSON.parse(
  readFileSync(".next/routes-manifest.json", "utf8"),
);
for (const path of [
  "/",
  "/plan?month=2026-12",
  "/plan/results",
  "/destinations/vienna",
  "/privacy",
  "/from/tirana",
]) {
  const request = new NextRequest(`https://www.trip-range.com${path}`);
  const response = proxy(request);
  const rewritten = new URL(response.headers.get("x-middleware-rewrite"));
  assert.equal(response.headers.get("location"), null);
  assert.equal(rewritten.search, request.nextUrl.search);
  const matches = redirects.filter((rule) =>
    new RegExp(rule.regex).test(rewritten.pathname),
  );
  assert.deepEqual(
    matches,
    [],
    `${path}: a config redirect matches internal rewrite ${rewritten.pathname}`,
  );
}
console.log(
  "PASS: built redirects do not intercept locale rewrites in Netlify execution order; no external calls.",
);
