import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDestinationPopulationBatch } from "../src/content/operator/batch";
import {
  loadEditorialWorkspace,
  safeLocalFile,
} from "./lib/editorial-workspace";
import {
  isBatchPreparation,
  reviewDestinationBatch,
} from "./lib/destination-batch-review";

export function parseBatchReviewArguments(args: string[]) {
  if (
    args.length !== 2 ||
    args[0] !== "--batch" ||
    !/^[a-z0-9][a-z0-9-]{0,79}$/.test(args[1])
  )
    throw Error("invalid-arguments");
  return args[1];
}

export function runBatchReview(args: string[]) {
  const id = parseBatchReviewArguments(args),
    root = process.cwd(),
    now = Date.now();
  const read = (path: string): unknown => {
    const file = resolve(root, path);
    safeLocalFile(root, file);
    return JSON.parse(readFileSync(file, "utf8"));
  };
  const batch = read(`content/operations/batches/${id}.json`);
  if (!isDestinationPopulationBatch(batch) || batch.id !== id)
    throw Error("invalid-batch");
  const path = `content/operations/preparation/${id}.json`;
  // Reject linked files even when they point to a missing target.
  safeLocalFile(root, resolve(root, path));
  const prep = existsSync(path) ? read(path) : undefined;
  if (prep !== undefined && !isBatchPreparation(prep, now))
    throw Error("invalid-preparation");
  const result = reviewDestinationBatch(
    batch,
    prep,
    loadEditorialWorkspace(),
    now,
  );
  for (const r of result.rows) {
    console.log(
      `${r.destinationId} | v${r.version} | sources ${r.sources} | digest ${r.digest}`,
    );
    console.log(
      `content ${r.contentStatus} | blockers ${r.blockers.length} | advisories ${r.advisories.length} | decision ${r.decision} | receipt ${r.receipt}`,
    );
    console.log(
      `checks ${Object.entries(r.checks)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")}`,
    );
    console.log(`travel ${r.travelIdentity} | ${r.readiness}`);
    if (r.blockers.length) console.log(`reasons: ${r.blockers.join(", ")}`);
  }
  console.log(
    `ready-for-human-review: ${result.ready}/${result.total}; writes: 0; external calls: 0; editorial approvals: 0`,
  );
  return result;
}

if (require.main === module) {
  try {
    runBatchReview(process.argv.slice(2));
  } catch {
    console.error(
      "Batch review failed: invalid arguments or source-controlled data. Usage: review:destination-batch -- --batch <id> (offline, read-only)",
    );
    process.exitCode = 1;
  }
}
