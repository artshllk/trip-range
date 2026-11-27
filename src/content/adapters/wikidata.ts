import "server-only";
import type { AttractionKind } from "../../domain/destination-content/types";
import { safeContentSourceUrl } from "../../domain/destination-content/validation";
import type { Coordinates, PlaceIdentity } from "../../domain/media/types";
import {
  coordinatesValid,
  identityValid,
  instant,
  object,
  subjectId,
  text,
  wikidataId,
} from "../../domain/media/validation";
import type { MediaApi } from "../../media/adapters/api";
import {
  claimValues,
  entities,
  entityIds,
} from "../../places/adapters/wikidata";
import { distanceKm, PLACE_RADIUS_KM } from "../../places/operator/identity";
import type {
  AttractionResearchCandidate,
  ResearchExclusion,
  ResearchSource,
} from "../operator/types";

export const CONTENT_RESEARCH_LIMITS = {
  candidates: 12,
  relatedEntities: 32,
} as const;

// Broad classes, never a list of attraction names or an editorial ranking.
const kinds: Readonly<Record<string, AttractionKind>> = {
  Q33506: "museum",
  Q22698: "park",
  Q570116: "other", // tourist attraction: requires later editorial selection
  Q4989906: "landmark", // monument
  Q1081138: "historic-site",
  Q24398318: "religious-site",
  Q40080: "beach",
};

/** CirrusSearch statement OR syntax; only validated entity IDs enter a query. */
export function attractionSearchQuery(destinationEntityId: string): string {
  if (!wikidataId(destinationEntityId)) throw Error("invalid-identity");
  return `haswbstatement:P131=${destinationEntityId}|P276=${destinationEntityId} haswbstatement:${Object.keys(
    kinds,
  )
    .map((id) => `P31=${id}`)
    .join("|")}`;
}

function earthPoint(entity: Record<string, unknown>): Coordinates | undefined {
  const values = claimValues(entity, "P625");
  if (
    values.length !== 1 ||
    !object(values[0]) ||
    !coordinatesValid(values[0]) ||
    values[0].globe !== "http://www.wikidata.org/entity/Q2"
  )
    return undefined;
  return {
    latitude: values[0].latitude as number,
    longitude: values[0].longitude as number,
  };
}

function countryMatches(
  entity: Record<string, unknown>,
  metadata: Map<string, Record<string, unknown>>,
  countryCode: string,
): boolean {
  const countries = entityIds(entity, "P17");
  if (countries.length !== 1) return false;
  const codes = claimValues(metadata.get(countries[0]) ?? {}, "P297");
  return codes.length === 1 && codes[0] === countryCode;
}

function relationshipFor(
  entity: Record<string, unknown>,
  identity: PlaceIdentity,
  metadata: Map<string, Record<string, unknown>>,
):
  | Pick<AttractionResearchCandidate["relationship"], "path" | "properties">
  | undefined {
  const destination = identity.external!.id;
  for (const property of ["P131", "P276"] as const) {
    if (entityIds(entity, property).includes(destination))
      return { path: [String(entity.id), destination], properties: [property] };
    // One corroborated administrative hop only; never follow an unbounded graph.
    for (const parentId of entityIds(entity, property)) {
      const parent = metadata.get(parentId);
      const point = parent && earthPoint(parent);
      if (
        parent &&
        point &&
        entityIds(parent, "P131").includes(destination) &&
        countryMatches(parent, metadata, identity.countryCode) &&
        distanceKm(identity.coordinates!, point) <=
          PLACE_RADIUS_KM[identity.placeKind]
      ) {
        return {
          path: [String(entity.id), parentId, destination],
          properties: [property, "P131"],
        };
      }
    }
  }
  return undefined;
}

function officialReference(
  entity: Record<string, unknown>,
): string | undefined {
  const urls = claimValues(entity, "P856");
  if (urls.length !== 1 || !safeContentSourceUrl(urls[0])) return undefined;
  const url = new URL(urls[0]);
  // References are not fetched. Avoid reflecting tracking/private query strings in diagnostics.
  return !url.search && !url.hash ? url.href : undefined;
}

export async function researchWikidataAttractions(
  api: MediaApi,
  identity: PlaceIdentity,
  retrievedAt: string,
) {
  if (
    !identityValid(identity) ||
    identity.external?.authority !== "wikidata" ||
    !wikidataId(identity.external.id) ||
    !coordinatesValid(identity.coordinates) ||
    !instant(retrievedAt)
  )
    throw Error("invalid-research-identity");
  const search = await api.get("wikidata", {
    action: "query",
    list: "search",
    srnamespace: "0",
    srlimit: String(CONTENT_RESEARCH_LIMITS.candidates),
    srsearch: attractionSearchQuery(identity.external.id),
    srprop: "",
  });
  if (
    !object(search.query) ||
    !Array.isArray(search.query.search) ||
    search.query.search.length > CONTENT_RESEARCH_LIMITS.candidates
  )
    throw Error("malformed-search");
  const ids = search.query.search.map((row) =>
    object(row) && wikidataId(row.title) ? row.title : null,
  );
  if (ids.some((id) => id === null) || new Set(ids).size !== ids.length)
    throw Error("malformed-search");
  const roots = await entities(api, ids as string[]);
  const metadataIds = [
    ...new Set(
      roots.flatMap((row) => [
        ...entityIds(row, "P31"),
        ...entityIds(row, "P17"),
        ...entityIds(row, "P131"),
        ...entityIds(row, "P276"),
      ]),
    ),
  ];
  if (metadataIds.length > CONTENT_RESEARCH_LIMITS.relatedEntities)
    throw Error("entity-bound-exceeded");
  const metadata = new Map(
    (await entities(api, metadataIds)).map((row) => [String(row.id), row]),
  );
  const candidates: AttractionResearchCandidate[] = [];
  const exclusions: ResearchExclusion[] = (ids as string[])
    .filter((id) => !roots.some((row) => row.id === id))
    .map((entityId) => ({ entityId, reason: "missing-entity" }));
  const sources = new Map<string, ResearchSource>();
  for (const row of roots) {
    const id = String(row.id);
    const candidateId = `attraction:${identity.subject}:wikidata-${id}`;
    if (!subjectId(candidateId)) throw Error("candidate-id-bound-exceeded");
    const exclude = (reason: ResearchExclusion["reason"]) =>
      exclusions.push({ entityId: id, reason });
    const name =
      object(row.labels) && object(row.labels.en)
        ? row.labels.en.value
        : undefined;
    if (!text(name, 180)) {
      exclude("missing-label");
      continue;
    }
    const typeIds = entityIds(row, "P31");
    const typeKinds = [
      ...new Set(
        typeIds
          .flatMap((typeId) => [
            typeId,
            ...entityIds(metadata.get(typeId) ?? {}, "P279"),
          ])
          .flatMap((typeId) => (kinds[typeId] ? [kinds[typeId]] : [])),
      ),
    ];
    if (!typeKinds.length) {
      exclude("unsupported-type");
      continue;
    }
    if (!countryMatches(row, metadata, identity.countryCode)) {
      exclude("country-mismatch");
      continue;
    }
    const coordinates = earthPoint(row);
    if (!coordinates) {
      exclude("missing-coordinates");
      continue;
    }
    const distance = distanceKm(identity.coordinates!, coordinates);
    if (distance > PLACE_RADIUS_KM[identity.placeKind]) {
      exclude("outside-destination");
      continue;
    }
    const relationship = relationshipFor(row, identity, metadata);
    if (!relationship) {
      exclude("unrelated-destination");
      continue;
    }
    const specificKinds = typeKinds.filter((kind) => kind !== "other");
    const sourceEntities = [
      ...new Set([
        id,
        ...relationship.path.slice(1),
        ...entityIds(row, "P17"),
        ...typeIds,
      ]),
    ];
    const sourceIds = sourceEntities.map((entityId) => {
      const sourceId = `wikidata:${entityId}`;
      sources.set(sourceId, {
        id: sourceId,
        type: "wikidata",
        externalId: entityId,
        url: `https://www.wikidata.org/wiki/${entityId}`,
        retrievedAt,
      });
      return sourceId;
    });
    candidates.push({
      id: candidateId,
      destinationId: identity.subject,
      external: { authority: "wikidata", id },
      name: { en: name },
      kind: specificKinds.length === 1 ? specificKinds[0] : "other",
      coordinates,
      countryCode: identity.countryCode,
      relationship: {
        destinationEntityId: identity.external.id,
        ...relationship,
        distanceKm: Math.round(distance * 100) / 100,
      },
      ...(officialReference(row)
        ? { officialWebsiteReference: officialReference(row) }
        : {}),
      sourceIds,
      reviewStatus: "candidate",
    });
  }
  return {
    candidates,
    sources: [...sources.values()],
    exclusions,
    truncated: search.continue !== undefined,
  };
}
