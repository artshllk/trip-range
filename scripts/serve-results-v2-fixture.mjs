/** Local QA only: the existing fixture intercepts every outbound fetch. */
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import "./fixtures/guard.mjs";
const env = { ...process.env };
// Do not let local credentials participate in this synthetic browser run.
for (const line of readFileSync(".env.example", "utf8").split("\n")) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
  if (match) env[match[1]] = "";
}
Object.assign(env, {
  TRAVELPAYOUTS_API_TOKEN: "synthetic-local-qa",
  TRAVELPAYOUTS_PROJECT_ID: "123",
  TRAVELPAYOUTS_MARKER: "456",
  RATE_LIMIT_REDIS_REST_URL: "https://synthetic-search-qa.upstash.io",
  RATE_LIMIT_REDIS_REST_TOKEN: "synthetic-local-qa",
  GOEKSPLO_LOG_LEVEL: "off",
  GOEKSPLO_SEARCH_RECOVERY_FIXTURE: "1",
  NODE_OPTIONS: `--import=${process.cwd()}/scripts/fixtures/search-recovery.mjs`,
});
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3162",
  ],
  { env, stdio: "inherit" },
);
process.on("SIGTERM", () => child.kill());
process.on("SIGINT", () => child.kill());
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
