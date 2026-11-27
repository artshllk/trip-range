import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  renameSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
const script = resolve("scripts/netlify-ignore-build.mjs");
test("real Git comparisons and fail-open cases", () => {
  const dir = mkdtempSync(join(tmpdir(), "netlify-ignore-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  const write = (p, text = "x") => {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), text);
  };
  const commit = () => {
    git("add", ".");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "fixture",
    );
    return git("rev-parse", "HEAD");
  };
  const run = (label, old, current, expected, extra = {}) => {
    const r = spawnSync(process.execPath, [script], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        CACHED_COMMIT_REF: old,
        COMMIT_REF: current,
        ...extra,
      },
    });
    console.log(
      `CACHED_COMMIT_REF=${old || "(missing)"} COMMIT_REF=${current} node ./scripts/netlify-ignore-build.mjs`,
    );
    console.log(`${label}: exit ${r.status}; ${r.stdout.trim()}`);
    assert.equal(r.status, expected, label);
  };
  try {
    git("init", "-q");
    write("src/app.ts");
    const base = commit();
    write("docs/research/data.json", "{}");
    write("notes\nwith-space.md");
    const docs = commit();
    run("docs-only", base, docs, 0);
    write("src/app.ts", "changed");
    const source = commit();
    run("source", docs, source, 1);
    for (const path of ["package.json", "config.json", "netlify.toml"]) {
      const before = git("rev-parse", "HEAD");
      write(path);
      run(path, before, commit(), 1);
    }
    const before = git("rev-parse", "HEAD");
    renameSync(join(dir, "src/app.ts"), join(dir, "docs/app.ts"));
    run("source moved into docs", before, commit(), 1);
    let prior = git("rev-parse", "HEAD");
    write("src/README.MD");
    run("Markdown anywhere", prior, commit(), 0);
    prior = git("rev-parse", "HEAD");
    rmSync(join(dir, "docs/research/data.json"));
    run("docs deletion", prior, commit(), 0);
    prior = git("rev-parse", "HEAD");
    write("src/page.mdx");
    run("MDX application source", prior, commit(), 1);
    run("missing cache", "", source, 1);
    run("invalid cache", "not-a-sha", source, 1);
    run("unavailable cache", "a".repeat(40), source, 1);
    run("cleared cache", source, source, 1);
    const bin = join(dir, "fake-bin");
    mkdirSync(bin);
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    writeFileSync(
      join(bin, "git"),
      `#!/bin/sh\nif [ "$1" = diff ]; then exit 2; fi\nexec '${realGit}' "$@"\n`,
      { mode: 0o755 },
    );
    run("comparison errors", base, docs, 1, {
      PATH: bin + ":" + process.env.PATH,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
