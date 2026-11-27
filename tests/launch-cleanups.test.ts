import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { legalDocuments } from "../src/services/legal";
import { securityHeaders } from "../src/config/security";

test("a legal effective date is either unset (pending the owner) or a real ISO date, and the page renders it", () => {
  for (const [name, byLocale] of Object.entries(legalDocuments))
    for (const [locale, doc] of Object.entries(byLocale)) {
      const date = (doc as { effectiveDate?: string }).effectiveDate;
      if (date !== undefined)
        assert.ok(
          /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)),
          `${name}/${locale}`,
        );
    }
  assert.match(
    readFileSync("src/app/[locale]/[document]/page.tsx", "utf8"),
    /copy\.effectiveDate &&/,
  );
});

test("the CSP allows no third-party script or connection origins", () => {
  for (const production of [true, false]) {
    const csp = securityHeaders(production).find(
      (h) => h.key === "Content-Security-Policy",
    )!.value;
    assert.doesNotMatch(csp, /vercel/);
    assert.match(csp, /connect-src 'self'(;|$)/);
    assert.match(csp, /script-src 'self' 'unsafe-inline'/);
  }
});
