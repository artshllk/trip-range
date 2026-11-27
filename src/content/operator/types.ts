import type { AttractionKind } from "../../domain/destination-content/types";
import type {
  Coordinates,
  ExternalIdentity,
  PlaceIdentity,
} from "../../domain/places/types";
import type { MediaApiFailure } from "../../media/adapters/api";

/** Research output cannot satisfy a reviewed DestinationContent record. */
export type AttractionResearchCandidate = {
  id: string;
  destinationId: string;
  external: ExternalIdentity;
  name: { en: string };
  kind: AttractionKind;
  coordinates: Coordinates;
  countryCode: string;
  relationship: {
    destinationEntityId: string;
    path: string[];
    properties: Array<"P131" | "P276">;
    distanceKm: number;
  };
  officialWebsiteReference?: string;
  sourceIds: string[];
  reviewStatus: "candidate";
};

export type ResearchSource = {
  id: string;
  type: "wikidata";
  externalId: string;
  url: string;
  retrievedAt: string;
};

export type ResearchExclusion = {
  entityId: string;
  reason:
    | "missing-label"
    | "unsupported-type"
    | "country-mismatch"
    | "missing-coordinates"
    | "outside-destination"
    | "unrelated-destination"
    | "missing-entity";
};

export type ContentResearchReport = {
  destinationId: string;
  status: "offline" | "unresolved" | "complete" | "unavailable";
  identity: PlaceIdentity;
  automaticPublication: false;
  osmEnrichment: "disabled";
  candidates: AttractionResearchCandidate[];
  sources: ResearchSource[];
  exclusions: ResearchExclusion[];
  truncated: boolean;
  requests: { wikidata: number; commons: number };
  failures: MediaApiFailure[];
  reason?:
    | "invalid-input"
    | "identity-unresolved"
    | "bounded-research-unavailable";
};

/** Optional future enrichment seam. No OSM adapter or persistence is enabled in V1. */
export interface OsmContentEnrichment {
  enrich(identity: PlaceIdentity): Promise<{
    status: "disabled";
    facts: [];
    reason: "licensing-and-attribution-review-required";
  }>;
}
