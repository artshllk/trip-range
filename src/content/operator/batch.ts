import { keys, object, subjectId, text } from "../../domain/places/validation";
import type { PlaceIdentity } from "../../domain/places/types";
import type { DestinationQueueRecord } from "./operations";

export type DestinationPopulationBatch = {
  schemaVersion: 1;
  id: string;
  title: string;
  entries: {
    destinationId: string;
    name: string;
    region: string;
    placeKind: PlaceIdentity["placeKind"];
    group: string;
  }[];
};

/** A bounded operator selection, never runtime support or publication policy. */
export function isDestinationPopulationBatch(
  value: unknown,
): value is DestinationPopulationBatch {
  if (
    !object(value) ||
    !keys(value, ["schemaVersion", "id", "title", "entries"]) ||
    value.schemaVersion !== 1 ||
    !subjectId(value.id) ||
    !text(value.title, 160) ||
    !Array.isArray(value.entries) ||
    !value.entries.length ||
    value.entries.length > 100
  )
    return false;
  const seen = new Set<string>();
  for (const entry of value.entries) {
    if (
      !object(entry) ||
      !keys(entry, ["destinationId", "name", "region", "placeKind", "group"]) ||
      !subjectId(entry.destinationId) ||
      seen.has(entry.destinationId) ||
      !text(entry.name, 160) ||
      !text(entry.region, 80) ||
      !text(entry.group, 80) ||
      !["city", "island", "region", "nature-area"].includes(
        String(entry.placeKind),
      )
    )
      return false;
    seen.add(entry.destinationId);
  }
  return true;
}

export function validatePopulationBatchAssociations(
  batch: DestinationPopulationBatch,
  queue: readonly DestinationQueueRecord[],
  identities: readonly PlaceIdentity[],
): string[] {
  const queued = new Set(queue.map((entry) => entry.destinationId));
  const places = new Map(identities.map((place) => [place.subject, place]));
  const errors: string[] = [];
  for (const entry of batch.entries) {
    if (!queued.has(entry.destinationId)) errors.push("batch-entry-not-queued");
    const place = places.get(entry.destinationId);
    if (place && place.placeKind !== entry.placeKind)
      errors.push("batch-place-kind-mismatch");
  }
  return errors;
}
