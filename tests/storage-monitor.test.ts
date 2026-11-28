import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  collectionGate,
  collectionStopBytes,
  collectionStopLine,
  storageTriggerBytes,
  storageUsage,
} from "../scripts/check-storage";
import { outcomeFailsRun } from "../src/domain/fare-refresh";

const limit = 1024 ** 3;
const usage = (bytes: number, limitBytes = limit) =>
  storageUsage({
    used_bytes: String(bytes),
    limit_bytes: String(limitBytes),
  });

test("capacity review triggers strictly above 800 MiB under the 1 GiB limit", () => {
  assert.equal(storageTriggerBytes, 838_860_800);
  assert.equal(usage(0).triggerBytes, storageTriggerBytes);
  // Projected trip-length range (about 545 MB settled, 700 MB at month start) stays quiet.
  assert.equal(usage(700 * 1000 ** 2).status, "ok");
  // The old 600 MiB trigger no longer fires.
  assert.equal(usage(629_145_601).status, "ok");
  assert.equal(usage(storageTriggerBytes).status, "ok");
  assert.equal(usage(storageTriggerBytes + 1).status, "alert");
  assert.equal(usage(limit + 1).status, "alert");
  assert.equal(usage(64 * 1024 ** 2).percentUsed, 6.25);
});

test("under a lower limit the trigger scales to the same share (800/1024)", () => {
  const small = 512 * 1024 ** 2;
  assert.equal(usage(0, small).triggerBytes, 400 * 1024 ** 2);
  assert.equal(usage(400 * 1024 ** 2, small).status, "ok");
  assert.equal(usage(400 * 1024 ** 2 + 1, small).status, "alert");
  assert.equal(
    storageUsage({ used_bytes: "782", limit_bytes: "1000" }).status,
    "alert",
  );
  assert.equal(
    storageUsage({ used_bytes: "781", limit_bytes: "1000" }).status,
    "ok",
  );
});

test("unavailable or invalid measurements cannot report healthy capacity", () => {
  for (const value of [
    null,
    undefined,
    "",
    "NaN",
    "-1",
    "1.5",
    "9007199254740992",
  ]) {
    assert.throws(() =>
      storageUsage({ used_bytes: value, limit_bytes: String(limit) }),
    );
    assert.throws(() => storageUsage({ used_bytes: "64", limit_bytes: value }));
  }
  assert.throws(() => storageUsage({ used_bytes: "64", limit_bytes: "0" }));
});

test("collection stops strictly above 900 MiB under the 1 GiB limit", () => {
  assert.equal(collectionStopBytes, 943_718_400);
  assert.equal(usage(0).stopBytes, collectionStopBytes);
  assert.equal(usage(collectionStopBytes).collectionStopped, false);
  assert.equal(usage(collectionStopBytes + 1).collectionStopped, true);
  // The 800 MiB review alert always comes first.
  assert.equal(usage(storageTriggerBytes + 1).status, "alert");
  assert.equal(usage(storageTriggerBytes + 1).collectionStopped, false);
});

test("under a lower limit the stop scales to the same share (900/1024)", () => {
  const small = 512 * 1024 ** 2;
  assert.equal(usage(0, small).stopBytes, 450 * 1024 ** 2);
  assert.equal(usage(450 * 1024 ** 2 + 1, small).collectionStopped, true);
  assert.ok(usage(0, small).triggerBytes < usage(0, small).stopBytes);
});

test("the gate lets collection run below the stop and stops it above", async () => {
  const below = await collectionGate(async () => usage(collectionStopBytes));
  assert.equal(below.stop, false);
  const above = await collectionGate(async () =>
    usage(collectionStopBytes + 1),
  );
  assert.equal(above.stop, true);
  assert.equal(above.stop && above.reason, "above-stop");
});

test("the gate fails closed when storage cannot be measured", async () => {
  for (const measure of [
    async () => {
      throw Error("postgres://user:secret@host/db unreachable");
    },
    // Missing limit setting or malformed figures: storageUsage throws.
    async () => storageUsage({ used_bytes: "64", limit_bytes: null }),
    async () => storageUsage({ used_bytes: "NaN", limit_bytes: "1073741824" }),
  ]) {
    const gate = await collectionGate(measure);
    assert.deepEqual(gate, { stop: true, reason: "unmeasured" });
  }
});

test("the stop line says why, what was skipped and how it resumes, with no driver text", async () => {
  const above = await collectionGate(async () => usage(957_000_000));
  assert.ok(above.stop);
  const line = collectionStopLine(above, ["LON 2026-12", "WAW 2026-12"]);
  assert.match(line, /^fare-warm: stopped: /);
  assert.match(
    line,
    /912\.7 MiB, above the 900\.0 MiB collection stop \(limit 1024\.0 MiB\)/,
  );
  assert.match(line, /No fares collected for LON 2026-12, WAW 2026-12\./);
  assert.match(line, /Clean-up still runs\./);
  const unmeasured = await collectionGate(async () => {
    throw Error("postgres://user:secret@host/db");
  });
  assert.ok(unmeasured.stop);
  const quiet = collectionStopLine(unmeasured, ["TIA 2026-12"]);
  assert.match(quiet, /could not be measured/);
  assert.doesNotMatch(quiet, /secret|postgres:/);
});

test("a stopped month does not fail the run; real failures still do", () => {
  for (const ok of ["complete", "skipped", "stopped"])
    assert.equal(outcomeFailsRun(ok), false, ok);
  for (const bad of ["failed", "aborted", "not run"])
    assert.equal(outcomeFailsRun(bad), true, bad);
});

test("the workflow keeps a stopped run green and opens the issue once", () => {
  const workflow = readFileSync(".github/workflows/fare-warm.yml", "utf8");
  const step = workflow.slice(
    workflow.indexOf("- name: Open or update the collection-stopped issue"),
    workflow.indexOf("- name: Open or update the alert issue"),
  );
  assert.match(step, /\^fare-warm: stopped:/);
  // Edits an open issue (no repeat email) and creates one only when none is open.
  assert.match(step, /gh issue edit "\$number" --body-file stopped-body\.md/);
  assert.match(
    step,
    /gh issue create --title "\$title" --body-file stopped-body\.md/,
  );
  assert.doesNotMatch(step, /gh issue comment|exit 1/);
  // Only the collector's exit code fails the run.
  assert.match(
    workflow,
    /- name: Fail the run so GitHub emails\n\s+if: steps\.warm\.outputs\.code != '0'\n\s+run: exit 1/,
  );
});
