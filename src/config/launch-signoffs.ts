import evidence from "./launch-signoffs.json";

/** Reviewed records, not switches: no environment variable can waive a launch gate. */
export const launchRequirements = {
  "launch-scope": "launch-scope-unverified",
  "credential-revocation": "historical-openai-revocation-unconfirmed",
  "production-release": "production-release-unverified",
  "production-runtime": "production-runtime-unverified",
  "shared-endpoint-limits": "shared-endpoint-limits-unverified",
  "host-tls": "production-host-tls-unverified",
  "domain-indexing": "domain-indexing-unverified",
  "coverage-streak": "fare-coverage-streak-unverified",
  "legal-review": "legal-review-pending",
  "contact-mailbox": "contact-mailbox-unverified",
  "provider-enrollment": "provider-enrollment-smoke-unverified",
  "edge-abuse-controls": "edge-abuse-controls-unverified",
  "hosted-security-headers": "hosted-security-headers-unverified",
  "private-access": "private-access-unverified",
} as const;

export const launchSignoffs = evidence;

/** Missing, duplicate, undated, future or expired evidence cannot clear a gate.
 * A source reference documents the review; this function does not re-perform it.
 * The committed review must be invalidated when its deployment/scope changes.
 */
export function signoffBlockers(input: unknown, now = new Date()) {
  const root = input as {
    schemaVersion?: unknown;
    scope?: unknown;
    checks?: unknown;
  } | null;
  const records =
    root?.schemaVersion === 1 &&
    root.scope === "tirana-english-month-flexible-v1" &&
    Array.isArray(root.checks)
      ? root.checks
      : [];
  const today = now.toISOString().slice(0, 10);
  const validDay = (value: unknown): value is string =>
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  return Object.entries(launchRequirements).flatMap(([id, blocker]) => {
    const matches = records.filter(
      (r) => r && typeof r === "object" && r.id === id,
    );
    const row = matches[0];
    const verified =
      matches.length === 1 &&
      row.status === "verified" &&
      validDay(row.checkedOn) &&
      row.checkedOn <= today &&
      typeof row.reviewedBy === "string" &&
      row.reviewedBy.trim().length > 0 &&
      typeof row.evidence === "string" &&
      row.evidence.trim().length > 0 &&
      (row.reviewBy === undefined ||
        (validDay(row.reviewBy) &&
          row.reviewBy >= row.checkedOn &&
          row.reviewBy >= today));
    return verified ? [] : [blocker];
  });
}
