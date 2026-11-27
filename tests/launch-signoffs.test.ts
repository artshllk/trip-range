import { test } from "node:test";
import assert from "node:assert/strict";
import {
  launchRequirements,
  launchSignoffs,
  signoffBlockers,
} from "../src/config/launch-signoffs";
import {
  launchReadiness,
  legalPlaceholderReport,
} from "../src/config/readiness";
import { validateEnvironment } from "../src/config/environment";

const now = new Date("2026-11-20T13:00:00Z");
/** When the committed records were last reviewed (25 November 2026). */
const reviewed = new Date("2026-11-25T16:00:00Z");
const complete = () => ({
  schemaVersion: 1,
  scope: "tirana-english-month-flexible-v1",
  checks: Object.keys(launchRequirements).map((id) => ({
    id,
    status: "verified",
    checkedOn: "2026-11-20",
    reviewedBy: "Test reviewer",
    evidence: "synthetic-test-evidence",
    reviewBy: "2026-11-27",
  })),
});
const configured = () =>
  validateEnvironment({
    VERCEL_ENV: "production",
    TRAVELPAYOUTS_API_TOKEN: "synthetic-token-value",
    TRAVELPAYOUTS_PROJECT_ID: "123",
    TRAVELPAYOUTS_MARKER: "456",
    RATE_LIMIT_REDIS_REST_URL: "https://fixture.upstash.io",
    RATE_LIMIT_REDIS_REST_TOKEN: "synthetic-redis-value",
    DATABASE_URL: "postgresql://fixture:fixture@localhost/fixture",
  });

test("sign-off records fail closed rather than accepting unchecked or missing gates", () => {
  assert.deepEqual(signoffBlockers(complete(), now), []);
  for (const input of [
    undefined,
    null,
    {},
    { ...complete(), schemaVersion: 2 },
    { ...complete(), scope: "old-launch" },
  ]) {
    assert.equal(
      signoffBlockers(input, now).length,
      Object.keys(launchRequirements).length,
    );
  }
  for (const patch of [
    { status: "pending" },
    { status: "waived" },
    { checkedOn: "2026-11-21" },
    { checkedOn: "2026-02-30" },
    { checkedOn: "" },
    { evidence: " " },
    { reviewedBy: "" },
    { reviewBy: "2026-11-19" },
    { reviewBy: "bad" },
  ]) {
    const data = complete();
    Object.assign(data.checks[0], patch);
    assert.deepEqual(signoffBlockers(data, now), ["launch-scope-unverified"]);
  }
  const duplicate = complete();
  duplicate.checks.push(duplicate.checks[0]);
  assert.deepEqual(signoffBlockers(duplicate, now), [
    "launch-scope-unverified",
  ]);
  const missing = complete();
  missing.checks.shift();
  assert.deepEqual(signoffBlockers(missing, now), ["launch-scope-unverified"]);
});

test("checked-in evidence clears completed checks only and expires operational reviews", () => {
  const blockers = signoffBlockers(launchSignoffs, reviewed);
  assert.deepEqual(blockers, [
    "launch-scope-unverified",
    "production-release-unverified",
    "production-runtime-unverified",
    "shared-endpoint-limits-unverified",
    "production-host-tls-unverified",
    "domain-indexing-unverified",
    "fare-coverage-streak-unverified",
    "legal-review-pending",
    "contact-mailbox-unverified",
    "provider-enrollment-smoke-unverified",
    "edge-abuse-controls-unverified",
    "hosted-security-headers-unverified",
  ]);
  const expired = signoffBlockers(
    launchSignoffs,
    new Date("2026-11-28T12:00:00Z"),
  );
  assert.ok(expired.includes("production-runtime-unverified"));
  assert.ok(expired.includes("shared-endpoint-limits-unverified"));
  assert.equal(
    expired.includes("historical-openai-revocation-unconfirmed"),
    false,
  );
});

test("complete sign-offs cannot hide broken runtime configuration or active legal placeholders", () => {
  const legal = { pending: false, documents: [] };
  assert.equal(
    launchReadiness(configured(), legal, complete(), now).ready,
    true,
  );
  assert.equal(
    launchReadiness(
      configured(),
      { pending: true, documents: ["privacy:en"] },
      complete(),
      now,
    ).ready,
    false,
  );
  assert.equal(
    launchReadiness(validateEnvironment({}), legal, complete(), now).ready,
    false,
  );
  assert.equal(
    launchReadiness(configured(), legal, launchSignoffs, now).ready,
    false,
  );
  const ai = configured();
  ai.ai.enabled = true;
  assert.ok(
    launchReadiness(ai, legal, complete(), now).configuration.includes(
      "launch-ai-must-be-off",
    ),
  );
});

test("legal placeholders are assessed for launched English only, without certifying legal review", () => {
  assert.equal(legalPlaceholderReport().pending, false);
  assert.equal(legalPlaceholderReport({}).pending, true);
  assert.ok(
    launchReadiness(
      configured(),
      undefined,
      launchSignoffs,
      now,
    ).manual.includes("legal-review-pending"),
  );
});
