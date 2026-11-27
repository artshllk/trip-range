import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { schedules } from "./qstash-schedules.mjs";

const crons = (file) =>
  [
    ...readFileSync(`.github/workflows/${file}`, "utf8").matchAll(
      /^\s*- cron:\s*["']([^"']+)["']/gm,
    ),
  ].map((m) => m[1]);

test("every QStash schedule matches a fallback cron in its workflow", () => {
  for (const s of schedules)
    assert.ok(
      crons(s.workflow).includes(s.cron),
      `${s.id}: ${s.cron} not in ${s.workflow}`,
    );
});

test("every scheduled workflow has a QStash schedule and accepts workflow_dispatch", () => {
  // Every workflow with a GitHub cron, so a new scheduled workflow cannot be added
  // without its QStash trigger.
  const scheduled = readdirSync(".github/workflows").filter((f) =>
    /^\s*schedule:/m.test(readFileSync(`.github/workflows/${f}`, "utf8")),
  );
  assert.ok(scheduled.includes("collector-watchdog.yml"));
  for (const file of scheduled) {
    const text = readFileSync(`.github/workflows/${file}`, "utf8");
    assert.match(text, /workflow_dispatch:/, file);
    for (const cron of crons(file))
      assert.ok(
        schedules.some((s) => s.workflow === file && s.cron === cron),
        `${file}: fallback ${cron} has no QStash schedule`,
      );
  }
});

test("collector schedules dispatch the gated modes, never force", () => {
  const modes = schedules
    .filter((s) => s.workflow === "fare-warm.yml")
    .map((s) => s.inputs?.mode)
    .sort();
  assert.deepEqual(modes, ["catch-up", "sweep"]);
});

test("schedule ids are valid and unique", () => {
  const ids = schedules.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9._-]+$/);
});
