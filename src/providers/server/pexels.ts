import "server-only";
import type { Destination, ImageAsset } from "../../domain/types";
import { providerJson, record, type ProviderFetch } from "./http";
export const IMAGE_CACHE_SECONDS = 86400;
function safeUrl(
  value: unknown,
  host: string,
  prefix: string,
): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === host &&
      !url.port &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith(prefix)
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
export function createPexelsImages(
  key: string,
  catalogue: Destination[],
  fetcher: ProviderFetch = fetch,
  timeoutMs = 2500,
): { forDestination(id: string): Promise<ImageAsset> } {
  return {
    async forDestination(id) {
      const destination = catalogue.find((d) => d.id === id);
      if (!destination) throw new RangeError("Unknown image destination");
      const fallback = destination.image;
      if (!fallback)
        throw new RangeError(
          "Legacy candidate catalogue requires a fallback record",
        );
      if (fallback.verification === "verified") return fallback;
      const url = new URL("https://api.pexels.com/v1/search");
      url.search = new URLSearchParams({
        query:
          destination.imageQuery ??
          `${destination.name.en} ${destination.country.en}`,
        orientation: "landscape",
        size: "large",
        per_page: "5",
        page: "1",
        locale: "en-US",
      }).toString();
      const result = await providerJson(
        url.toString(),
        { Authorization: key },
        IMAGE_CACHE_SECONDS,
        fetcher,
        timeoutMs,
      );
      const fail = (reason: string): ImageAsset => ({
        ...fallback,
        sourceStatus: { status: "fallback", reason },
      });
      if (!result.ok) return fail(result.reason);
      if (!record(result.body) || !Array.isArray(result.body.photos))
        return fail("malformed-response");
      for (const photo of result.body.photos.slice(0, 5)) {
        if (JSON.stringify(photo).includes(key)) continue;
        if (
          !record(photo) ||
          !record(photo.src) ||
          typeof photo.id !== "number" ||
          !Number.isSafeInteger(photo.id) ||
          typeof photo.width !== "number" ||
          typeof photo.height !== "number" ||
          photo.width < 1600 ||
          photo.width / photo.height < 1.3 ||
          photo.width / photo.height > 2.4 ||
          typeof photo.photographer !== "string" ||
          !photo.photographer.trim()
        )
          continue;
        const src = safeUrl(
          photo.src.original,
          "images.pexels.com",
          "/photos/",
        );
        const photoUrl = safeUrl(photo.url, "www.pexels.com", "/photo/");
        const authorUrl = safeUrl(
          photo.photographer_url,
          "www.pexels.com",
          "/@",
        );
        if (!src || new URL(src).search || !photoUrl || !authorUrl) continue;
        return {
          src,
          source: "provider",
          sourceId: String(photo.id),
          author: photo.photographer.slice(0, 200),
          authorUrl,
          photoUrl,
          attribution: `Photo by ${photo.photographer.slice(0, 200)} on Pexels`,
          license: "https://www.pexels.com/license/",
          destinationId: id,
          verification: "unverified",
          sourceStatus: { status: "available" },
          alt:
            typeof photo.alt === "string" ? photo.alt.slice(0, 300) : undefined,
        };
      }
      return fail("no-suitable-image");
    },
  };
}
