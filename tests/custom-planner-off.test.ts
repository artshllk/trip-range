import assert from "node:assert/strict";
import test from "node:test";
import { customPlannerEnabled } from "../src/config/features";

// Owner decision, 24 November 2026: the custom planner stays off until real
// whole-trip cost evidence exists, and its copy is then rebuilt, not patched.
// Turning it on must be a reviewed change to this test and the handover.
test("the custom trip planner is switched off", () => {
  assert.equal(customPlannerEnabled, false);
});
