import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { auditHistory, secretCategories } from "./check-history-secrets.mjs";
test("history audit finds a removed synthetic credential and emits metadata only", () => {
  const cwd = mkdtempSync(join(tmpdir(), "goeksplo-history-test-"));
  const secret = "sk-" + "synthetic".repeat(8);
  const git = (args) => execFileSync("git", args, { cwd, stdio: "pipe" });
  try {
    git(["init", "-q"]);
    writeFileSync(join(cwd, ".env.example"), `OPENAI_API_KEY=${secret}\n`);
    git(["add", ".env.example"]);
    git([
      "-c",
      "user.name=Synthetic Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "Synthetic fixture",
    ]);
    writeFileSync(join(cwd, ".env.example"), "OPENAI_API_KEY=\n");
    git(["add", ".env.example"]);
    git([
      "-c",
      "user.name=Synthetic Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "Remove fixture",
    ]);
    const report = auditHistory(cwd);
    assert.equal(report.complete, true);
    assert.equal(report.findings.length, 1);
    assert.equal(report.findings[0].category, "openai-credential");
    assert.equal(report.findings[0].path, ".env.example");
    assert.match(report.findings[0].commit, /^[a-f0-9]{12}$/);
    assert.equal(JSON.stringify(report).includes(secret), false);
    assert.equal(git(["status", "--porcelain"]).toString(), "");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
test("history scanner keeps blank/example config clean and failed audits explicit", () => {
  assert.deepEqual(
    secretCategories(
      "OPENAI_API_KEY=\nTRAVELPAYOUTS_API_TOKEN=\nRATE_LIMIT_REDIS_REST_TOKEN=\nPEXELS_API_KEY=\nOPENAI_MODEL=gpt-6-luna",
    ),
    [],
  );
  assert.deepEqual(
    secretCategories(
      "TRAVELPAYOUTS_API_TOKEN=your_example_value\nTRAVELPAYOUTS_API_TOKEN=" +
        "fixture".repeat(5),
    ),
    ["travelpayouts-credential"],
  );
  const report = auditHistory(join(tmpdir(), "missing-history-repository"));
  assert.equal(report.status, "incomplete");
  assert.equal(report.complete, false);
  assert.equal(JSON.stringify(report).includes("fatal:"), false);
});
