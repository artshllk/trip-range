import "server-only";
import type { Destination, ImageAsset } from "../../domain/types";
import { createWikimediaImages } from "./wikimedia";
import { createPexelsImages } from "./pexels";
import type { ProviderFetch } from "./http";

/** Candidate discovery retained for future reviewed ingestion. Never compose into page views. */
export function createImageCandidateDiscovery(
  catalogue: Destination[],
  pexelsKey?: string,
  fetcher: ProviderFetch = fetch,
): { forDestination(id: string): Promise<ImageAsset> } {
  const commons = createWikimediaImages(catalogue, fetcher);
  const pexels = pexelsKey
    ? createPexelsImages(pexelsKey, catalogue, fetcher)
    : undefined;
  return {
    async forDestination(id) {
      const d = catalogue.find((d) => d.id === id);
      if (!d) throw new RangeError("Unknown image destination");
      if (
        d.image?.source !== "provider" &&
        d.image?.verification === "verified"
      )
        return d.image;
      const primary = await commons.forDestination(id);
      if (
        primary.source === "provider" &&
        primary.sourceStatus?.status === "available"
      )
        return primary;
      return pexels ? pexels.forDestination(id) : primary;
    },
  };
}
