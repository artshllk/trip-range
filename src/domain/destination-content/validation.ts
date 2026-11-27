import {
  coordinatesValid,
  identityValid,
  instant,
  object,
  subjectId,
  text,
  wikidataId,
} from "../media/validation";
import type {
  DestinationContentData,
  DestinationContentValidationContext,
} from "./types";

export const REQUIRED_CONTENT_LOCALES = ["en"] as const;
export const MAX_VOLATILE_VALIDITY_DAYS = 90;
export const MAX_PRICE_VALIDITY_DAYS = 30;
const DAY = 86_400_000;
const baseKeys = ["reviewStatus", "reviewedAt", "sourceIds", "freshness"];
const itemKeys = [...baseKeys, "id", "destinationId"];
const attractionKinds = [
  "landmark",
  "museum",
  "historic-site",
  "religious-site",
  "park",
  "viewpoint",
  "market",
  "beach",
  "nature",
  "district",
  "other",
];
const practicalKinds = [
  "booking",
  "closure",
  "transport",
  "tax",
  "payment",
  "accessibility",
  "seasonal",
  "safety",
  "entry",
  "other",
];
const keys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const member = (value: unknown, allowed: readonly string[]): value is string =>
  typeof value === "string" && allowed.includes(value);
const list = (value: unknown, max = 100): value is unknown[] =>
  Array.isArray(value) && value.length <= max;
const unique = (values: readonly unknown[]) =>
  new Set(values).size === values.length;
const positiveInteger = (value: unknown, max = 10_000) =>
  Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= max;
const contentCoordinates = (value: unknown) =>
  object(value) &&
  keys(value, ["latitude", "longitude"]) &&
  coordinatesValid(value);

/** Reference links only. No production or research code fetches these URLs. */
export function safeContentSourceUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    /[\s\\<>\u0000-\u001f\u007f-\u009f]/.test(value)
  )
    return false;
  try {
    const url = new URL(value);
    const authority = value.slice("https://".length).split("/")[0];
    return (
      value.startsWith("https://") &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      !authority.includes(":") &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(
        url.hostname,
      ) &&
      !/^[0-9.]+$/.test(url.hostname) &&
      !/(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(
        url.hostname,
      ) &&
      !/(?:%00|%0a|%0d|%5c)/i.test(value)
    );
  } catch {
    return false;
  }
}

function localized(value: unknown, max = 1200): boolean {
  return (
    object(value) &&
    Object.keys(value).length <= 30 &&
    REQUIRED_CONTENT_LOCALES.every((locale) => text(value[locale], max)) &&
    Object.entries(value).every(
      ([locale, copy]) =>
        /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale) && text(copy, max),
    )
  );
}
function review(value: Record<string, unknown>): boolean {
  return (
    member(value.reviewStatus, ["draft", "reviewed", "withdrawn"]) &&
    (value.reviewStatus === "draft"
      ? value.reviewedAt === null
      : instant(value.reviewedAt))
  );
}
function externalIdentity(value: unknown): boolean {
  if (!object(value) || !keys(value, ["authority", "id"])) return false;
  if (value.authority === "wikidata") return wikidataId(value.id);
  if (value.authority === "openstreetmap")
    return (
      typeof value.id === "string" &&
      /^(?:node|way|relation)\/[1-9]\d{0,15}$/.test(value.id)
    );
  return false;
}
function source(value: unknown): boolean {
  if (
    !object(value) ||
    !keys(value, [
      "id",
      "type",
      "url",
      "externalId",
      "title",
      "publisher",
      "observedAt",
      "retrievedAt",
      "licensing",
    ]) ||
    !subjectId(value.id) ||
    !member(value.type, [
      "wikidata",
      "openstreetmap",
      "official",
      "internal-reviewed",
    ]) ||
    !text(value.title, 240) ||
    !text(value.publisher, 160) ||
    (value.url !== undefined && !safeContentSourceUrl(value.url)) ||
    (value.externalId !== undefined && !externalIdentity(value.externalId)) ||
    (value.observedAt !== undefined && !instant(value.observedAt)) ||
    (value.retrievedAt !== undefined && !instant(value.retrievedAt)) ||
    (instant(value.observedAt) &&
      instant(value.retrievedAt) &&
      Date.parse(value.observedAt) > Date.parse(value.retrievedAt))
  )
    return false;
  if (value.type === "official" && !safeContentSourceUrl(value.url))
    return false;
  if (
    value.type === "wikidata" &&
    (!object(value.externalId) ||
      value.externalId.authority !== "wikidata" ||
      (value.url !== undefined &&
        value.url !== `https://www.wikidata.org/wiki/${value.externalId.id}`))
  )
    return false;
  if (
    value.licensing !== undefined &&
    (!object(value.licensing) ||
      !keys(value.licensing, ["identifier", "url", "attribution"]) ||
      !text(value.licensing.identifier, 80) ||
      !safeContentSourceUrl(value.licensing.url) ||
      !text(value.licensing.attribution, 500))
  )
    return false;
  if (
    value.type === "openstreetmap" &&
    (!object(value.externalId) ||
      value.externalId.authority !== "openstreetmap" ||
      value.url !== `https://www.openstreetmap.org/${value.externalId.id}` ||
      !object(value.licensing) ||
      value.licensing.identifier !== "ODbL-1.0" ||
      value.licensing.url !==
        "https://opendatacommons.org/licenses/odbl/1.0/" ||
      !text(value.licensing.attribution, 500) ||
      !value.licensing.attribution.includes("OpenStreetMap contributors"))
  )
    return false;
  return true;
}
function sourceIds(
  value: unknown,
  sources: Map<string, Record<string, unknown>>,
): value is string[] {
  return (
    list(value, 30) &&
    value.length > 0 &&
    unique(value) &&
    value.every((id) => subjectId(id) && sources.has(id))
  );
}
function sourced(
  value: Record<string, unknown>,
  sources: Map<string, Record<string, unknown>>,
): boolean {
  if (
    !review(value) ||
    !sourceIds(value.sourceIds, sources) ||
    !object(value.freshness)
  )
    return false;
  const f = value.freshness;
  if (f.kind === "stable") return keys(f, ["kind"]);
  if (f.kind === "periodically-reviewed")
    return (
      keys(f, ["kind", "reviewBy"]) &&
      instant(f.reviewBy) &&
      (!instant(value.reviewedAt) ||
        Date.parse(f.reviewBy) > Date.parse(value.reviewedAt))
    );
  if (
    f.kind !== "volatile" ||
    !keys(f, ["kind", "observedAt", "validUntil"]) ||
    !instant(f.observedAt) ||
    !instant(f.validUntil)
  )
    return false;
  const validity = Date.parse(f.validUntil) - Date.parse(f.observedAt);
  return (
    validity > 0 &&
    validity <= MAX_VOLATILE_VALIDITY_DAYS * DAY &&
    (!instant(value.reviewedAt) ||
      (Date.parse(value.reviewedAt) >= Date.parse(f.observedAt) &&
        Date.parse(value.reviewedAt) < Date.parse(f.validUntil))) &&
    value.sourceIds.some((id) => {
      const reference = sources.get(id)!;
      return (
        reference.type === "official" &&
        reference.observedAt === f.observedAt &&
        safeContentSourceUrl(reference.url)
      );
    })
  );
}
function priceValid(
  value: Record<string, unknown>,
  sources: Map<string, Record<string, unknown>>,
): boolean {
  if (value.observedPrice === undefined) return true;
  const price = value.observedPrice,
    f = value.freshness;
  if (
    !object(price) ||
    !keys(price, ["amount", "currency", "sourceId", "observedAt"]) ||
    typeof price.amount !== "number" ||
    !Number.isFinite(price.amount) ||
    price.amount < 0 ||
    price.amount > 1_000_000 ||
    typeof price.currency !== "string" ||
    !/^[A-Z]{3}$/.test(price.currency) ||
    !instant(price.observedAt) ||
    !object(f) ||
    f.kind !== "volatile" ||
    price.observedAt !== f.observedAt ||
    !instant(f.validUntil) ||
    Date.parse(f.validUntil) - Date.parse(price.observedAt) >
      MAX_PRICE_VALIDITY_DAYS * DAY ||
    !sourceIds(value.sourceIds, sources) ||
    !subjectId(price.sourceId) ||
    !value.sourceIds.includes(price.sourceId)
  )
    return false;
  const reference = sources.get(price.sourceId);
  return (
    reference?.type === "official" && reference.observedAt === price.observedAt
  );
}
function bounds(value: unknown): boolean {
  return (
    object(value) &&
    keys(value, ["north", "south", "east", "west"]) &&
    coordinatesValid({ latitude: value.north, longitude: value.east }) &&
    coordinatesValid({ latitude: value.south, longitude: value.west }) &&
    Number(value.north) >= Number(value.south) &&
    Number(value.east) >= Number(value.west)
  );
}

/** Deterministic structural validation; expiry is enforced again on every runtime read. */
export function validateDestinationContentData(
  input: unknown,
  context: DestinationContentValidationContext,
):
  | { ok: true; data: DestinationContentData; errors: [] }
  | { ok: false; errors: string[] } {
  if (
    !object(input) ||
    !keys(input, ["schemaVersion", "records"]) ||
    input.schemaVersion !== 1 ||
    !Array.isArray(input.records)
  )
    return { ok: false, errors: ["invalid-store-shape"] };
  if (
    !object(context) ||
    !Array.isArray(context.identities) ||
    !context.identities.every(identityValid) ||
    !unique(context.identities.map((i) => i.subject)) ||
    !Array.isArray(context.mediaSubjects) ||
    !context.mediaSubjects.every(subjectId) ||
    !unique(context.mediaSubjects)
  )
    return { ok: false, errors: ["invalid-validation-context"] };
  const identities = new Map(
    context.identities.map((identity) => [identity.subject, identity]),
  );
  const mediaSubjects = new Set(context.mediaSubjects);
  const destinations = new Set<string>(),
    allSourceIds = new Set<string>(),
    itemIds = new Set<string>(),
    externalAttractions = new Set<string>();
  const errors: string[] = [];
  const error = (path: string, reason: string) => {
    if (errors.length < 100) errors.push(`${path}:${reason}`);
  };
  input.records.forEach((record, recordIndex) => {
    const path = `records[${recordIndex}]`;
    if (!object(record)) {
      error(path, "invalid-record");
      return;
    }
    if (
      !keys(record, [
        "destinationId",
        "identitySubject",
        "contentVersion",
        "publication",
        "reviewStatus",
        "reviewedAt",
        "sourceIds",
        "sources",
        "overview",
        "highlights",
        "attractions",
        "areas",
        "transport",
        "practicalNotes",
        "dayTemplates",
      ]) ||
      !subjectId(record.destinationId) ||
      record.identitySubject !== record.destinationId ||
      !positiveInteger(record.contentVersion, 1_000_000) ||
      !review(record)
    )
      error(path, "invalid-record");
    if (
      record.publication !== undefined &&
      (!object(record.publication) ||
        !keys(record.publication, [
          "contentDigest",
          "identityDigest",
          "approvedAt",
        ]) ||
        !/^[a-f0-9]{64}$/.test(String(record.publication.contentDigest)) ||
        !/^[a-f0-9]{64}$/.test(String(record.publication.identityDigest)) ||
        !instant(record.publication.approvedAt))
    )
      error(path, "invalid-publication-receipt");
    if (typeof record.destinationId === "string") {
      if (destinations.has(record.destinationId))
        error(path, "duplicate-destination-id");
      destinations.add(record.destinationId);
    }
    const identity =
      typeof record.identitySubject === "string"
        ? identities.get(record.identitySubject)
        : undefined;
    if (!identity) error(path, "unknown-destination");
    else if (
      record.reviewStatus === "reviewed" &&
      identity.confidence === "unresolved"
    )
      error(path, "unresolved-destination-identity");
    const sources = new Map<string, Record<string, unknown>>();
    if (!list(record.sources, 100)) error(path, "invalid-sources");
    else
      record.sources.forEach((reference, sourceIndex) => {
        if (!source(reference))
          error(`${path}.sources[${sourceIndex}]`, "invalid-source");
        if (object(reference) && subjectId(reference.id)) {
          if (allSourceIds.has(reference.id))
            error(`${path}.sources[${sourceIndex}]`, "duplicate-source-id");
          allSourceIds.add(reference.id);
          sources.set(reference.id, reference);
        }
      });
    if (!sourceIds(record.sourceIds, sources))
      error(path, "missing-provenance");
    if (
      record.overview !== undefined &&
      (!object(record.overview) ||
        !keys(record.overview, [...baseKeys, "text"]) ||
        !sourced(record.overview, sources) ||
        !localized(record.overview.text))
    )
      error(`${path}.overview`, "invalid-overview");
    const attractionIds = new Set<string>();
    if (list(record.attractions))
      record.attractions.forEach((attraction) => {
        if (object(attraction) && subjectId(attraction.id))
          attractionIds.add(attraction.id);
      });
    for (const field of [
      "highlights",
      "attractions",
      "areas",
      "transport",
      "practicalNotes",
      "dayTemplates",
    ] as const) {
      if (record[field] === undefined) continue;
      if (!list(record[field])) {
        error(`${path}.${field}`, "invalid-list");
        continue;
      }
      (record[field] as unknown[]).forEach((item, index) => {
        const itemPath = `${path}.${field}[${index}]`;
        if (!object(item)) {
          error(itemPath, "invalid-item");
          return;
        }
        if (!subjectId(item.id) || !sourced(item, sources))
          error(itemPath, "invalid-reviewed-provenance");
        if (typeof item.id === "string") {
          if (itemIds.has(item.id)) error(itemPath, "duplicate-item-id");
          itemIds.add(item.id);
        }
        if (
          field !== "highlights" &&
          item.destinationId !== record.destinationId
        )
          error(itemPath, "destination-mismatch");
        if (
          field === "highlights" &&
          (!keys(item, [...baseKeys, "id", "text"]) ||
            !localized(item.text, 500))
        )
          error(itemPath, "invalid-highlight");
        if (field === "attractions") {
          if (
            !keys(item, [
              ...itemKeys,
              "externalIdentities",
              "name",
              "kind",
              "coordinates",
              "shortDescription",
              "whyVisit",
              "typicalVisitMinutes",
              "bookingAdvice",
              "media",
            ]) ||
            !localized(item.name, 180) ||
            !localized(item.shortDescription, 600) ||
            !member(item.kind, attractionKinds) ||
            (item.whyVisit !== undefined && !localized(item.whyVisit, 500)) ||
            (item.bookingAdvice !== undefined &&
              !localized(item.bookingAdvice, 500)) ||
            (item.coordinates !== undefined &&
              !contentCoordinates(item.coordinates)) ||
            (item.typicalVisitMinutes !== undefined &&
              (!object(item.typicalVisitMinutes) ||
                !keys(item.typicalVisitMinutes, ["minimum", "maximum"]) ||
                !positiveInteger(item.typicalVisitMinutes.minimum, 1440) ||
                !positiveInteger(item.typicalVisitMinutes.maximum, 1440) ||
                Number(item.typicalVisitMinutes.minimum) >
                  Number(item.typicalVisitMinutes.maximum)))
          )
            error(itemPath, "invalid-attraction");
          if (item.externalIdentities !== undefined) {
            if (
              !list(item.externalIdentities, 10) ||
              !item.externalIdentities.every(externalIdentity)
            )
              error(itemPath, "invalid-external-identity");
            else
              item.externalIdentities.forEach((external) => {
                const e = external as { authority: string; id: string },
                  key = `${record.destinationId}|${e.authority}|${e.id}`;
                if (externalAttractions.has(key))
                  error(itemPath, "duplicate-attraction-entity");
                externalAttractions.add(key);
              });
          }
          if (
            item.media !== undefined &&
            (!object(item.media) ||
              !keys(item.media, ["subject", "role"]) ||
              item.media.role !== "attraction.primary" ||
              item.media.subject !== item.id ||
              !subjectId(item.media.subject) ||
              !mediaSubjects.has(item.media.subject))
          )
            error(itemPath, "unknown-or-invalid-media-reference");
        }
        if (
          field === "areas" &&
          (!keys(item, [
            ...itemKeys,
            "name",
            "summary",
            "goodFor",
            "tradeoffs",
            "coordinates",
            "bounds",
          ]) ||
            !localized(item.name, 180) ||
            !localized(item.summary, 600) ||
            !list(item.goodFor, 12) ||
            !item.goodFor.every((t) => localized(t, 300)) ||
            !list(item.tradeoffs, 12) ||
            !item.tradeoffs.every((t) => localized(t, 300)) ||
            (item.coordinates !== undefined &&
              !contentCoordinates(item.coordinates)) ||
            (item.bounds !== undefined && !bounds(item.bounds)))
        )
          error(itemPath, "invalid-area");
        if (
          field === "transport" &&
          (!keys(item, [...itemKeys, "title", "guidance", "observedPrice"]) ||
            !localized(item.title, 180) ||
            !localized(item.guidance, 800) ||
            !priceValid(item, sources))
        )
          error(itemPath, "invalid-transport-guide");
        if (
          field === "practicalNotes" &&
          (!keys(item, [...itemKeys, "kind", "text", "observedPrice"]) ||
            !member(item.kind, practicalKinds) ||
            !localized(item.text, 800) ||
            !priceValid(item, sources))
        )
          error(itemPath, "invalid-practical-note");
        if (
          field === "practicalNotes" &&
          member(item.kind, ["closure", "tax", "entry"]) &&
          (!object(item.freshness) || item.freshness.kind !== "volatile")
        )
          error(itemPath, "volatile-category-requires-freshness");
        if (
          field === "practicalNotes" &&
          item.kind === "seasonal" &&
          object(item.freshness) &&
          item.freshness.kind === "stable"
        )
          error(itemPath, "seasonal-category-requires-review-deadline");
        if (field === "dayTemplates") {
          if (
            !keys(item, [
              ...itemKeys,
              "suitableNights",
              "title",
              "stops",
              "notes",
            ]) ||
            !localized(item.title, 180) ||
            !list(item.suitableNights, 30) ||
            item.suitableNights.length === 0 ||
            !unique(item.suitableNights) ||
            !item.suitableNights.every((n) => positiveInteger(n, 30)) ||
            !list(item.stops, 24) ||
            item.stops.length === 0 ||
            (item.notes !== undefined && !localized(item.notes, 800))
          )
            error(itemPath, "invalid-day-template");
          if (list(item.stops, 24)) {
            const seenStops = new Set<string>();
            item.stops.forEach((stop) => {
              if (
                !object(stop) ||
                !keys(stop, ["attractionId", "day", "notes"]) ||
                !subjectId(stop.attractionId) ||
                !attractionIds.has(stop.attractionId) ||
                seenStops.has(stop.attractionId) ||
                (stop.day !== undefined && !positiveInteger(stop.day, 31)) ||
                (stop.notes !== undefined && !localized(stop.notes, 300))
              )
                error(itemPath, "broken-attraction-reference");
              else seenStops.add(stop.attractionId);
            });
            const days = item.stops.map((stop) =>
              object(stop) ? stop.day : undefined,
            );
            if (days.some((day) => day !== undefined)) {
              // No guessed day labels: all stops belong to ordered, contiguous calendar days.
              const nights =
                list(item.suitableNights, 30) &&
                item.suitableNights.length === 1
                  ? item.suitableNights[0]
                  : undefined;
              if (
                typeof nights !== "number" ||
                days.some(
                  (day) =>
                    typeof day !== "number" ||
                    !positiveInteger(day, nights + 1),
                ) ||
                days.some(
                  (day, i) => i > 0 && Number(day) < Number(days[i - 1]),
                ) ||
                new Set(days).size !== nights + 1
              )
                error(itemPath, "invalid-calendar-day-grouping");
            }
          }
        }
      });
    }
  });
  return errors.length
    ? { ok: false, errors }
    : { ok: true, data: input as DestinationContentData, errors: [] };
}
