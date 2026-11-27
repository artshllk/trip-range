import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CHILD_RENDER_TIMEOUT_MS = 20_000;

export type ChildRenderOptions = {
  timeoutMs?: number;
  /** Node flags placed before `-e`, such as `--conditions=react-server`. */
  nodeArgs?: string[];
  env?: NodeJS.ProcessEnv;
};

/**
 * Runs a render script in a fresh Node (without the test runner's react-server
 * condition unless asked). Input is written to a temporary JSON file whose path is
 * `process.argv[1]` in the script: no stdin (it is closed), and no argv size limit.
 * A child still running at the timeout is killed with SIGKILL and the call throws,
 * so a stuck render fails its test instead of hanging the run or outliving it.
 */
export function renderInChild(
  script: string,
  input?: unknown,
  {
    timeoutMs = CHILD_RENDER_TIMEOUT_MS,
    nodeArgs = [],
    env,
  }: ChildRenderOptions = {},
) {
  const dir =
    input === undefined ? undefined : mkdtempSync(join(tmpdir(), "render-"));
  const file = dir && join(dir, "input.json");
  if (file) writeFileSync(file, JSON.stringify(input));
  try {
    return execFileSync(
      process.execPath,
      [...nodeArgs, "-e", script, ...(file ? [file] : [])],
      {
        encoding: "utf8",
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        stdio: ["ignore", "pipe", "pipe"],
        ...(env ? { env } : {}),
      },
    );
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

/** Child-side expression that reads the input written by renderInChild. */
export const CHILD_INPUT =
  "JSON.parse(require('node:fs').readFileSync(process.argv[1],'utf8'))";
