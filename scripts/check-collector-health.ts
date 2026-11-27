import { appendFileSync, writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { referenceCalendarDate } from "../src/domain/dates";
import { discoveryMonths } from "../src/domain/month-discovery";
import {
  collectionStall,
  collectorOrigins,
  refreshEndpoint,
} from "../src/domain/fare-refresh";

// Collector watchdog (owner decision, 23 November 2026). Reads only the fare store,
// never the collector's workflow runs, so it notices a collector that never starts.
// Writes collector-health.md (issue body) and `stale=true|false` for the workflow.
// Exit 1 means the store could not be read: unknown is never reported as healthy.
async function main() {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL is required");
  const sql = neon(process.env.DATABASE_URL);
  const now = Date.now();
  const months = discoveryMonths(referenceCalendarDate(new Date(now)));
  const rows = await sql`select origin, departure_month,
      max(attempted_at) as last_success
    from warm_attempts
    where endpoint = ${refreshEndpoint} and outcome = 'stored'
      and origin = any(${collectorOrigins}) and departure_month = any(${months})
    group by 1, 2`;
  const last = Object.fromEntries(
    rows.map((r) => [
      r.origin.trim() + "|" + r.departure_month,
      r.last_success,
    ]),
  );
  const result = collectionStall(last, collectorOrigins, months, now);
  const at = new Date(now).toISOString();
  console.log(JSON.stringify({ checkedAt: at, ...result }));
  const table = [
    "| Origin | Month | Last successful completion (UTC) | Age (hours) |",
    "|---|---|---|---|",
    ...result.items.map(
      (i) =>
        `| ${i.origin} | ${i.month} | ${i.lastSuccess ?? "never"} | ${i.ageHours}${i.ageHours > result.hours ? " ⚠️" : ""} |`,
    ),
  ].join("\n");
  const run = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : "local";
  const body = result.stale
    ? [
        `**No full successful fare collection for more than ${result.hours} hours.** The oldest origin-month is ${result.oldest.origin} ${result.oldest.month}, ${result.oldest.ageHours} hours since its last successful completion.`,
        "The fare store keeps provider observations for seven days: without recovery, fares start disappearing from the site within a week of the last success.",
        'Diagnose in this order (details: docs/collector/handover.md, "20-hour alert"): 1. QStash delivery log and dead-letter queue; 2. GitHub token validity; 3. GitHub Actions status; 4. collector run logs.',
        table,
        `Checked ${at} by the collector watchdog. This issue is updated hourly while the stall lasts and closed automatically after recovery. Run: ${run}`,
      ].join("\n\n")
    : [
        `Recovered: every origin-month has a successful completion within ${result.hours} hours (checked ${at}).`,
        table,
        `Run: ${run}`,
      ].join("\n\n");
  writeFileSync("collector-health.md", body + "\n");
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `stale=${result.stale}\n`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, body + "\n");
}

main().catch(() => {
  // Driver errors can contain connection details; print none.
  console.error(
    "collector watchdog failed: the fare store could not be read; collection health is unknown",
  );
  process.exitCode = 1;
});
