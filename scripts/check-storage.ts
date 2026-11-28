import { appendFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

/**
 * Owner decision, 28 November 2026 (replacing 600 MiB of 23 November): review above
 * 800 MiB against the 1 GiB enforced limit. The trip-length collector (2 and 3 nights
 * everywhere, 7 for London and Warsaw, 8-day fare rows) is projected from the
 * measured 28 November sweep to settle near 545 MB and peak near 700 MB early in a
 * month. 700 MiB would fire at every month start; 800 MiB stays quiet there and
 * leaves about 1.5 days of month-start intake (about 150 MiB a day if clean-up
 * stopped) before the limit. Under a lower enforced limit the trigger scales down to
 * the same share (800/1024, so exactly 800 MiB at 1 GiB).
 */
export const storageTriggerBytes = 800 * 1024 ** 2;
export const storageTriggerShareOfLimit = 800 / 1024;
export function storageUsage(row: {
  used_bytes: unknown;
  limit_bytes: unknown;
}) {
  const bytes = (value: unknown) => {
    if (typeof value !== "string" || !/^\d+$/.test(value))
      throw Error("Invalid storage measurement");
    const n = Number(value);
    if (!Number.isSafeInteger(n)) throw Error("Invalid storage measurement");
    return n;
  };
  const usedBytes = bytes(row.used_bytes);
  const limitBytes = bytes(row.limit_bytes);
  if (limitBytes <= 0) throw Error("Storage limit is unavailable");
  const triggerBytes = Math.min(
    storageTriggerBytes,
    Math.floor(limitBytes * storageTriggerShareOfLimit),
  );
  return {
    status: usedBytes > triggerBytes ? "alert" : "ok",
    usedBytes,
    limitBytes,
    triggerBytes,
    percentUsed: Number(((usedBytes / limitBytes) * 100).toFixed(2)),
  };
}

function stepSummary(message: string) {
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Database storage\n${message}\n`,
    );
}

async function main() {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL is required");
  const sql = neon(process.env.DATABASE_URL);
  // The enforced limit applies to the cluster, not only the application database.
  // Include system databases, matching the capacity audit's measurement scope.
  const [rows] = await sql.transaction(
    [
      sql`select sum(pg_database_size(oid))::text as used_bytes,
        pg_size_bytes(nullif(current_setting('neon.max_cluster_size', true), ''))::text as limit_bytes
        from pg_database`,
    ],
    { readOnly: true, fetchOptions: { signal: AbortSignal.timeout(20_000) } },
  );
  const usage = storageUsage({
    used_bytes: rows[0]?.used_bytes,
    limit_bytes: rows[0]?.limit_bytes,
  });
  const message = `${usage.usedBytes} / ${usage.limitBytes} bytes (${usage.percentUsed.toFixed(2)}%); capacity review trigger: usage > ${usage.triggerBytes} bytes (800 MiB, or 78.1% of the limit if lower).`;
  console.log(`storage: ${usage.status}: ${message}`);
  console.log(JSON.stringify(usage, null, 2));
  if (usage.status === "alert")
    console.log(
      `::warning::Database storage: ${message} Revisit capacity; no automatic configuration change.`,
    );
  stepSummary(message);
  process.exitCode = usage.status === "alert" ? 1 : 0;
}

if (require.main === module) {
  main().catch(() => {
    // Driver exceptions can contain connection details. Emit no raw error/payload.
    const message =
      "storage check failed: usage or the enforced limit could not be verified; check database access and neon.max_cluster_size.";
    console.error(message);
    stepSummary(message);
    process.exitCode = 1;
  });
}
