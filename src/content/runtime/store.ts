import type {
  ContentReview,
  ContentSource,
  DestinationContent,
  DestinationContentStore,
  DestinationContentValidationContext,
  SourcedContent,
} from "../../domain/destination-content/types";
import { validateDestinationContentData } from "../../domain/destination-content/validation";

function reviewed(value: ContentReview, now: number): boolean {
  return (
    value.reviewStatus === "reviewed" &&
    value.reviewedAt !== null &&
    Date.parse(value.reviewedAt) <= now
  );
}
function observedSources(
  sourceIds: string[],
  sources: ContentSource[],
  now: number,
): boolean {
  return sourceIds.every((id) => {
    const source = sources.find((candidate) => candidate.id === id);
    return (
      !!source &&
      (!source.observedAt || Date.parse(source.observedAt) <= now) &&
      (!source.retrievedAt || Date.parse(source.retrievedAt) <= now)
    );
  });
}
function current(
  value: SourcedContent,
  sources: ContentSource[],
  now: number,
): boolean {
  if (!reviewed(value, now) || !observedSources(value.sourceIds, sources, now))
    return false;
  if (value.freshness.kind === "periodically-reviewed")
    return Date.parse(value.freshness.reviewBy) > now;
  if (value.freshness.kind === "volatile")
    return (
      Date.parse(value.freshness.observedAt) <= now &&
      Date.parse(value.freshness.validUntil) > now
    );
  return true;
}
function publish(
  record: DestinationContent,
  now: number,
): DestinationContent | undefined {
  const content: DestinationContent = JSON.parse(JSON.stringify(record));
  delete content.publication; // Integrity metadata is not a client presentation field.
  const visible = <T extends SourcedContent>(items?: T[]): T[] | undefined =>
    items?.filter((item) => current(item, record.sources, now));
  if (content.overview && !current(content.overview, record.sources, now))
    delete content.overview;
  content.highlights = visible(content.highlights);
  content.attractions = visible(content.attractions);
  content.areas = visible(content.areas);
  content.transport = visible(content.transport);
  content.practicalNotes = visible(content.practicalNotes);
  const attractionIds = new Set(
    content.attractions?.map((attraction) => attraction.id),
  );
  content.dayTemplates = visible(content.dayTemplates)?.filter((template) =>
    template.stops.every((stop) => attractionIds.has(stop.attractionId)),
  );
  const sections = [
    content.highlights,
    content.attractions,
    content.areas,
    content.transport,
    content.practicalNotes,
    content.dayTemplates,
  ];
  if (!content.overview && !sections.some((section) => section?.length))
    return undefined;
  const usedSources = new Set(content.sourceIds);
  content.overview?.sourceIds.forEach((id) => usedSources.add(id));
  sections.forEach((section) =>
    section?.forEach((item) =>
      item.sourceIds.forEach((id) => usedSources.add(id)),
    ),
  );
  content.sources = content.sources.filter((source) =>
    usedSources.has(source.id),
  );
  return content;
}

/** Pure adapter core. Private validated snapshot; expiry is checked at read time, not startup. */
export function createReviewedDestinationContentStore(
  input: unknown,
  context: DestinationContentValidationContext,
  clock: () => number = Date.now,
): DestinationContentStore {
  let parsed: ReturnType<typeof validateDestinationContentData>;
  try {
    parsed = validateDestinationContentData(
      JSON.parse(JSON.stringify(input)),
      JSON.parse(JSON.stringify(context)),
    );
  } catch {
    parsed = { ok: false, errors: ["invalid-store"] };
  }
  const records = new Map(
    parsed.ok
      ? parsed.data.records.map((record) => [record.destinationId, record])
      : [],
  );
  return {
    async get(destinationId) {
      if (!parsed.ok) return { status: "none", reason: "invalid-record" };
      const record = records.get(destinationId);
      if (!record) return { status: "none", reason: "missing-record" };
      let now: number;
      try {
        now = clock();
      } catch {
        return { status: "none", reason: "invalid-record" };
      }
      if (!Number.isFinite(now))
        return { status: "none", reason: "invalid-record" };
      if (
        !reviewed(record, now) ||
        !observedSources(record.sourceIds, record.sources, now)
      )
        return { status: "none", reason: "not-reviewed" };
      const content = publish(record, now);
      return content
        ? { status: "reviewed", content }
        : { status: "none", reason: "no-current-content" };
    },
  };
}
