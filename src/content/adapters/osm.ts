import "server-only";
import type { OsmContentEnrichment } from "../operator/types";

/** Deliberately no endpoint, fetcher, or OSM data ingestion until attribution is approved. */
export const disabledOsmContentEnrichment: OsmContentEnrichment = {
  async enrich() {
    return {
      status: "disabled",
      facts: [],
      reason: "licensing-and-attribution-review-required",
    };
  },
};
