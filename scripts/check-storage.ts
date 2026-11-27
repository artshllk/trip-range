import { appendFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

/**
 * Owner decision, 23 November 2026: review above 600 MiB against the 1 GiB enforced
 * limit. Measured four-origin sweeps (about 24.5 MB each, two a day, 10-day fare rows,
 * 2-day raw replies) settle the cluster near 430 MB on average and 530 MB in the first
 * days of a month. 600 MiB stays quiet in that range, fires within about four days if
 * clean-up stops, and fires when a fifth large origin is added (about 690 MB at the
 * month-start peak). Never later than 60% of the enforced limit, if that is lower.
 */
export const storageTriggerBytes = 600 * 1024 ** 2;
export const storageTriggerShareOfLimit = 0.6;
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
  const message = `${usage.usedBytes} / ${usage.limitBytes} bytes (${usage.percentUsed.toFixed(2)}%); capacity review trigger: usage > ${usage.triggerBytes} bytes (600 MiB, or 60% of the limit if lower).`;
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
