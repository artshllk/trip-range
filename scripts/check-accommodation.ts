import assert from "node:assert/strict";
import { defaultRequestFor } from "../src/domain/request";
import {
  estimateAccommodation,
  genericStayBasis,
} from "../src/domain/accommodation";
/** Offline arithmetic only. No environment, credentials, provider imports or network. */
export function checkAccommodation() {
  const checks: string[] = [];
  for (const currency of ["EUR", "GBP", "USD", "CHF"] as const) {
    const request = {
      ...defaultRequestFor("2026-10-13"),
      budget: { currency, cents: 100000 },
    };
    for (const nights of [1, 2, 14])
      for (const familyStay of [false, true]) {
        const r = {
          ...request,
          nights,
          party: { adults: 2, children: 2 },
          preferences: { ...request.preferences, familyStay },
        };
        const stay = estimateAccommodation(genericStayBasis(r), r);
        assert.equal(stay.kind, "generic-estimate");
        assert.equal(stay.paidNights, nights);
        assert.equal(stay.rooms, 2);
        assert.ok(stay.quote && stay.quote.amount.cents > 0);
      }
    checks.push(`${currency}: planning allocation and all nights passed`);
  }
  return {
    status: "passed",
    mode: "offline",
    accommodationInventory: false,
    checks,
    externalCalls: 0,
    writes: 0,
  };
}
if (require.main === module)
  console.log(JSON.stringify(checkAccommodation(), null, 2));
