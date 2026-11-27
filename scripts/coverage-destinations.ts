import { lstatSync, readFileSync } from "node:fs";
import { subjectId } from "../src/domain/places/validation";
import { loadContentOperations } from "./lib/content-operations";
import {
  destinationCoverage,
  destinationCoverageSummary,
} from "./lib/destination-coverage";
import {
  isDestinationPopulationBatch,
  validatePopulationBatchAssociations,
} from "../src/content/operator/batch";
import { seoLandingRegistry } from "../src/seo/registry";
import type { DestinationQueueRecord } from "../src/content/operator/operations";
import type { PlaceIdentity } from "../src/domain/places/types";

export function parseCoverageArguments(args: readonly string[]) {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (
      !["--destination", "--file", "--limit", "--offset"].includes(args[i]) ||
      !args[i + 1] ||
      flags.has(args[i])
    )
      throw Error("arguments");
    flags.set(args[i], args[i + 1]);
  }
  if (flags.has("--destination") && flags.has("--file"))
    throw Error("arguments");
  const limit = flags.get("--limit") ?? "50",
    offset = flags.get("--offset") ?? "0";
  if (
    !/^\d+$/.test(limit) ||
    +limit < 1 ||
    +limit > 100 ||
    !/^\d+$/.test(offset) ||
    !Number.isSafeInteger(+offset)
  )
    throw Error("arguments");
  const destination = flags.get("--destination");
  if (
    destination !== undefined &&
    (!subjectId(destination) || flags.has("--offset") || flags.has("--limit"))
  )
    throw Error("arguments");
  return {
    destination,
    file: flags.get("--file"),
    limit: +limit,
    offset: +offset,
  };
}
export function readCoverageBatch(
  file: string,
  associations?: {
    queue: readonly DestinationQueueRecord[];
    identities: readonly PlaceIdentity[];
  },
): string[] {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64000)
    throw Error("batch-file");
  const raw = readFileSync(file, "utf8");
  if (Buffer.byteLength(raw) > 64000) throw Error("batch-size");
  const value: unknown = JSON.parse(raw);
  if (
    associations &&
    isDestinationPopulationBatch(value) &&
    validatePopulationBatchAssociations(
      value,
      associations.queue,
      associations.identities,
    ).length
  )
    throw Error("batch-association");
  const ids: unknown = isDestinationPopulationBatch(value)
    ? value.entries.map((entry) => entry.destinationId)
    : value;
  if (
    !Array.isArray(ids) ||
    ids.length > 100 ||
    !ids.every(subjectId) ||
    new Set(ids).size !== ids.length
  )
    throw Error("batch-ids");
  return ids;
}
export async function runCoverageCommand(args: readonly string[]) {
  const options = parseCoverageArguments(args),
    operations = loadContentOperations();
  const ids = options.destination
    ? [options.destination]
    : options.file
      ? readCoverageBatch(options.file, {
          queue: operations.queue,
          identities: operations.context.identities,
        })
      : [
          ...new Set([
            ...operations.context.identities.map((p) => p.subject),
            ...operations.queue.map((r) => r.destinationId),
          ]),
        ].sort();
  const selected = options.destination
    ? ids
    : ids.slice(options.offset, options.offset + options.limit);
  console.log(
    "Destination | Identity | Evidence | Draft | Reviewed | Destination media | Lifecycle",
  );
  for (const destinationId of selected) {
    const report = await destinationCoverage({
      ...operations,
      destinationId,
      evidence: operations.evidence.get(destinationId) ?? "missing",
      filesValid: true,
      seo: seoLandingRegistry,
    });
    console.log(
      `${destinationId} | ${report.identity} | ${report.research} | ${report.contentDraft ? "yes" : "no"} | ${report.contentReviewed ? "yes" : "no"} | ${report.mediaDestination} | ${report.lifecycle}`,
    );
    if (options.destination) console.log(JSON.stringify(report, null, 2));
  }
  console.log(
    `Shown: ${selected.length} of ${ids.length}; offset: ${options.offset}. Writes: 0; external calls: 0; automatic approval: OFF.`,
  );
  console.log(
    JSON.stringify(
      {
        scope: "all selected IDs, including rows outside this page",
        ...destinationCoverageSummary({ ...operations, ids }),
      },
      null,
      2,
    ),
  );
  return 0;
}
if (require.main === module)
  void runCoverageCommand(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      console.error(
        "Coverage failed: invalid records or arguments. Usage: coverage:destinations [--destination <id> | --file <ids.json>] [--limit 1..100] [--offset <n>] (offline, read-only)",
      );
      process.exitCode = 1;
    });
