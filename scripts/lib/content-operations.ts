import { placeIdentities } from "../../src/places/runtime/registry";
import { isInactiveDestinationId } from "../../src/domain/destination-lifecycle";
import { placeRegistryData } from "../../content/places/records";
import { destinationContentData } from "../../content/destinations/records";
import { destinationResearchData } from "../../content/research/destinations/records";
import { destinationQueueData } from "../../content/operations/queue/records";
import approvedMedia from "../../content/media/approved.json";
import { validateMediaRegistry } from "../../src/domain/media/validation";
import { validateDestinationContentData } from "../../src/domain/destination-content/validation";
import {
  validateResearchData,
  validateQueueData,
} from "../../src/content/operator/operations";
import { checkDestinationContentFiles } from "./destination-content-files";
import { inspectDestinationEvidence } from "./destination-content-pipeline";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isDestinationPopulationBatch,
  validatePopulationBatchAssociations,
} from "../../src/content/operator/batch";

/** Ordinary commands are offline readers. No ingestion/research provider is imported. */
export function loadContentOperations() {
  const context = {
    identities: placeIdentities,
    mediaSubjects: placeIdentities.map((p) => p.subject),
  };
  const media = validateMediaRegistry(approvedMedia, placeIdentities);
  const content = validateDestinationContentData(
    destinationContentData,
    context,
  );
  const errors = [
    ...media.errors,
    ...content.errors,
    ...validateQueueData(destinationQueueData, placeIdentities),
    ...validateResearchData(
      destinationResearchData,
      placeIdentities,
      destinationQueueData.records,
    ),
  ];
  const batchDirectory = "content/operations/batches";
  for (const file of readdirSync(batchDirectory).filter((file) =>
    file.endsWith(".json"),
  )) {
    const path = join(batchDirectory, file),
      stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64000)
      throw Error("invalid-batch-file");
    const batch: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isDestinationPopulationBatch(batch))
      errors.push("invalid-population-batch");
    else
      errors.push(
        ...validatePopulationBatchAssociations(
          batch,
          destinationQueueData.records,
          placeIdentities,
        ),
      );
  }
  for (const [directory, records, key] of [
    ["content/places", placeRegistryData.records, "subject"],
    ["content/destinations", destinationContentData.records, "destinationId"],
    [
      "content/research/destinations",
      destinationResearchData.records,
      "destinationId",
    ],
    ["content/operations/queue", destinationQueueData.records, "destinationId"],
  ] as const) {
    const files = checkDestinationContentFiles(directory, records, key);
    if (!files.ok) errors.push(...files.errors);
  }
  const evidence = new Map(
    destinationResearchData.records.map((record) => [
      record.destinationId,
      inspectDestinationEvidence(record, "docs/research/destination-content"),
    ]),
  );
  if ([...evidence.values()].includes("invalid"))
    errors.push("invalid-evidence-report");
  if (errors.length || !media.ok)
    throw Error("invalid-source-controlled-operations");
  return {
    context: {
      identities: context.identities.filter(
        (p) => !isInactiveDestinationId(p.subject),
      ),
      mediaSubjects: context.mediaSubjects.filter(
        (id) => !isInactiveDestinationId(id),
      ),
    },
    media: media.data,
    data: destinationContentData,
    evidence,
    // Source files and batch receipts remain historical evidence. Archived entries
    // are not actionable research/review work and must not enter operator queues.
    queue: destinationQueueData.records.filter(
      (r) => !isInactiveDestinationId(r.destinationId),
    ),
    research: destinationResearchData.records.filter(
      (r) => !isInactiveDestinationId(r.destinationId),
    ),
  };
}
