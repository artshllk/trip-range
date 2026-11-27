import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { CHILD_INPUT, renderInChild } from "./child-render";

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("child render passes input through a file it removes afterwards", () => {
  const [value, file] = JSON.parse(
    renderInChild(
      `process.stdout.write(JSON.stringify([${CHILD_INPUT}.x, process.argv[1]]))`,
      { x: "ok" },
    ),
  );
  assert.equal(value, "ok");
  assert.equal(existsSync(file), false);
  assert.equal(existsSync(dirname(file)), false);
});

test("child render input has no argv size limit", () => {
  const big = "x".repeat(512 * 1024);
  assert.equal(
    renderInChild(`process.stdout.write(String(${CHILD_INPUT}.big.length))`, {
      big,
    }),
    String(big.length),
  );
});

test("a stuck child render is killed at the timeout and does not outlive the call", () => {
  let pid = 0;
  assert.throws(
    () => {
      try {
        renderInChild(
          "process.stdout.write(String(process.pid)); setInterval(() => {}, 1000)",
          undefined,
          { timeoutMs: 1000 },
        );
      } catch (error) {
        pid = Number((error as { stdout?: string }).stdout);
        throw error;
      }
    },
    (error: NodeJS.ErrnoException & { signal?: string }) =>
      error.code === "ETIMEDOUT" && error.signal === "SIGKILL",
  );
  assert.ok(pid > 0);
  assert.equal(alive(pid), false);
});

test("a child render never waits on stdin", () => {
  assert.equal(
    renderInChild(
      "process.stdout.write(String(require('node:fs').readFileSync(0).length))",
      undefined,
      { timeoutMs: 5000 },
    ),
    "0",
  );
});
