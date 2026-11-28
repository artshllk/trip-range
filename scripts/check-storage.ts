import { appendFileSync } from "node:fs";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

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
/**
 * Collection stop, owner decision 28 November 2026: above 900 MiB (or the same share,
 * 900/1024, of a lower enforced limit) the fare collector starts no new origin-month.
 * Losing a sweep is recoverable; filling the database is not. Checked before each
 * origin-month, so at most one month per origin is in progress when it trips.
 */
export const collectionStopBytes = 900 * 1024 ** 2;
export const collectionStopShareOfLimit = 900 / 1024;
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
  const stopBytes = Math.min(
    collectionStopBytes,
    Math.floor(limitBytes * collectionStopShareOfLimit),
  );
  return {
    status: usedBytes > triggerBytes ? "alert" : "ok",
    usedBytes,
    limitBytes,
    triggerBytes,
    stopBytes,
    collectionStopped: usedBytes > stopBytes,
    percentUsed: Number(((usedBytes / limitBytes) * 100).toFixed(2)),
  };
}
export type StorageUsage = ReturnType<typeof storageUsage>;

/**
 * One read-only measurement: every database in the cluster, including system
 * databases, against the enforced limit (it applies to the cluster). Throws when
 * either figure is unavailable or invalid; never reports zero usage.
 */
export async function readStorage(
  sql: NeonQueryFunction<false, false>,
): Promise<StorageUsage> {
  const [rows] = await sql.transaction(
    [
      sql`select sum(pg_database_size(oid))::text as used_bytes,
        pg_size_bytes(nullif(current_setting('neon.max_cluster_size', true), ''))::text as limit_bytes
        from pg_database`,
    ],
    { readOnly: true, fetchOptions: { signal: AbortSignal.timeout(20_000) } },
  );
  return storageUsage({
    used_bytes: rows[0]?.used_bytes,
    limit_bytes: rows[0]?.limit_bytes,
  });
}

export type CollectionGate =
  | { stop: false; usage: StorageUsage }
  | { stop: true; reason: "above-stop"; usage: StorageUsage }
  | { stop: true; reason: "unmeasured" };

/**
 * Whether the collector may start an origin-month. Fails closed: a measurement that
 * fails or is invalid stops collection like a breach (rule: fail closed when failing
 * open risks filling the database). There is no override.
 */
export async function collectionGate(
  measure: () => Promise<StorageUsage>,
): Promise<CollectionGate> {
  try {
    const usage = await measure();
    return usage.collectionStopped
      ? { stop: true, reason: "above-stop", usage }
      : { stop: false, usage };
  } catch {
    // Driver errors can contain connection details: keep only the fact.
    return { stop: true, reason: "unmeasured" };
  }
}

const mib = (bytes: number) => (bytes / 1024 ** 2).toFixed(1);

/** The single status line a stopped run prints; the workflow copies it into the issue. */
export function collectionStopLine(
  gate: Extract<CollectionGate, { stop: true }>,
  months: string[],
) {
  const why =
    gate.reason === "above-stop"
      ? `database storage is ${mib(gate.usage.usedBytes)} MiB, above the ${mib(gate.usage.stopBytes)} MiB collection stop (limit ${mib(gate.usage.limitBytes)} MiB).`
      : "database storage or its limit could not be measured, so the collector cannot tell whether writing is safe.";
  const resume =
    gate.reason === "above-stop"
      ? `Collection resumes on its own once storage is at or under ${mib(gate.usage.stopBytes)} MiB.`
      : "Collection resumes on its own once a measurement succeeds and is under the stop.";
  return `fare-warm: stopped: ${why} No fares collected for ${months.join(", ")}. Clean-up still runs. ${resume}`;
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
  const usage = await readStorage(neon(process.env.DATABASE_URL));
  const message = `${usage.usedBytes} / ${usage.limitBytes} bytes (${usage.percentUsed.toFixed(2)}%); capacity review trigger: usage > ${usage.triggerBytes} bytes (800 MiB, or 78.1% of the limit if lower); collection stop: usage > ${usage.stopBytes} bytes (900 MiB, or 87.9% of the limit if lower), ${usage.collectionStopped ? "IN FORCE: the fare collector starts no new month" : "not in force"}.`;
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
