import assert from "node:assert/strict";
import { pricePlan } from "../src/domain/pricing";
import { completePlan } from "../src/domain/flight-pricing";
export function priceComplete(...args: Parameters<typeof pricePlan>) {
  const plan = pricePlan(...args);
  assert.ok(completePlan(plan), "fixture must have complete pricing");
  return plan;
}
