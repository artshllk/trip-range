import "server-only";
import { createHash } from "node:crypto";
import type {
  DestinationContent,
  SourcedContent,
} from "../domain/destination-content/types";
import type { PlaceIdentity } from "../domain/places/types";

/** Object keys sorted; array order, strings and all factual values preserved. */
export function canonicalJson(value: unknown): string {
  const seen = new Set<object>();
  function encode(value: unknown, depth: number): string {
    if (depth > 100) throw Error("canonical-depth");
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean"
    )
      return JSON.stringify(value);
    if (typeof value === "number" && Number.isFinite(value))
      return JSON.stringify(value);
    if (!value || typeof value !== "object" || seen.has(value))
      throw Error("canonical-json-only");
    seen.add(value);
    let result: string;
    if (Array.isArray(value))
      result = `[${value.map((item) => encode(item, depth + 1)).join(",")}]`;
    else {
      if (
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null
      )
        throw Error("canonical-plain-object-only");
      result = `{${Object.keys(value)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${encode((value as Record<string, unknown>)[key], depth + 1)}`,
        )
        .join(",")}}`;
    }
    seen.delete(value);
    return result;
  }
  return encode(value, 0);
}
export const digest = (value: unknown): string =>
  createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");

export function contentItems(
  record: DestinationContent,
): { id: string; item: SourcedContent }[] {
  return [
    ...(record.overview ? [{ id: "overview", item: record.overview }] : []),
    ...[
      record.highlights,
      record.attractions,
      record.areas,
      record.transport,
      record.practicalNotes,
      record.dayTemplates,
    ].flatMap((items) => (items ?? []).map((item) => ({ id: item.id, item }))),
  ];
}

/** Normalize ONLY lifecycle metadata at known reviewable paths, never arbitrary keys. */
export function editorialContent(record: DestinationContent): unknown {
  const copy: DestinationContent = JSON.parse(JSON.stringify(record));
  delete copy.publication;
  for (const item of [copy, ...contentItems(copy).map(({ item }) => item)]) {
    const fields = item as unknown as Record<string, unknown>;
    delete fields.reviewStatus;
    delete fields.reviewedAt;
  }
  return copy;
}
export const contentDigest = (record: DestinationContent): string =>
  digest(editorialContent(record));

export function publicationReceiptMatches(
  record: DestinationContent,
  identity: PlaceIdentity,
): boolean {
  const receipt = record.publication;
  return (
    !!receipt &&
    record.reviewStatus === "reviewed" &&
    receipt.contentDigest === contentDigest(record) &&
    receipt.identityDigest === digest(identity) &&
    receipt.approvedAt === record.reviewedAt &&
    contentItems(record).every(
      ({ item }) =>
        item.reviewStatus === "reviewed" &&
        item.reviewedAt === receipt.approvedAt,
    )
  );
}
