import type { ImageAsset } from "./types";

const localRaster =
  /^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.(?:jpg|jpeg|png|webp|avif)$/;

/** Variants do not approve an image. They must belong to the same local file family. */
function validLocalVariants(image: ImageAsset): boolean {
  const variants = image.localVariants;
  if (variants === undefined) return true;
  if (!Array.isArray(variants) || variants.length < 2 || variants.length > 8)
    return false;
  const family = (src: string) =>
    src.replace(/-[1-9]\d*\.(jpg|jpeg|png|webp|avif)$/, ".$1");
  const base = variants.find((variant) => variant && variant.src === image.src);
  if (
    !base ||
    !Number.isInteger(base.width) ||
    !Number.isInteger(base.height) ||
    base.width <= 0 ||
    base.height <= 0
  )
    return false;
  return variants.every(
    (variant, index) =>
      !!variant &&
      typeof variant.src === "string" &&
      localRaster.test(variant.src) &&
      !variant.src.startsWith("/demo/") &&
      family(variant.src) === family(image.src) &&
      Number.isInteger(variant.width) &&
      variant.width >= 64 &&
      variant.width <= 8192 &&
      Number.isInteger(variant.height) &&
      variant.height > 0 &&
      variant.height <= 8192 &&
      variant.src.match(/-([1-9]\d*)\.(?:jpg|jpeg|png|webp|avif)$/)?.[1] ===
        String(variant.width) &&
      (index === 0 || variant.width > variants[index - 1].width) &&
      Math.abs(
        variant.width / variant.height / (base.width / base.height) - 1,
      ) < 0.005,
  );
}

/** Display containment, not image approval. Only existing explicit verification counts. */
export function trustedDestinationImage(
  image: ImageAsset | null | undefined,
  destinationId: string,
): image is ImageAsset {
  if (
    !image ||
    image.verification !== "verified" ||
    image.destinationId !== destinationId ||
    !destinationId ||
    image.source === "design-reference" ||
    !image.attribution.trim()
  )
    return false;
  if (image.source === "local") {
    // Brand/demo artwork can never stand in for a destination. Raster files only.
    return (
      !image.src.startsWith("/demo/") &&
      localRaster.test(image.src) &&
      validLocalVariants(image)
    );
  }
  if (image.localVariants !== undefined) return false;
  try {
    const url = new URL(image.src);
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname) ||
      !image.author?.trim()
    )
      return false;
    if (
      url.hostname === "upload.wikimedia.org" &&
      url.pathname.startsWith("/wikipedia/commons/") &&
      image.sourceId.startsWith("wikimedia-commons:")
    ) {
      return (
        safeCreditUrl(image.photoUrl, "commons.wikimedia.org", "/wiki/File:") &&
        /^https:\/\/creativecommons\.org\/(?:licenses\/(?:by|by-sa)\/(?:1\.0|2\.0|2\.5|3\.0|4\.0)|publicdomain\/(?:zero\/1\.0|mark\/1\.0))\/$/.test(
          image.license ?? "",
        )
      );
    }
    return (
      url.hostname === "images.pexels.com" &&
      url.pathname.startsWith("/photos/") &&
      safeCreditUrl(image.photoUrl, "www.pexels.com", "/photo/") &&
      safeCreditUrl(image.authorUrl, "www.pexels.com", "/@") &&
      image.license === "https://www.pexels.com/license/"
    );
  } catch {
    return false;
  }
}

function safeCreditUrl(
  value: string | undefined,
  host: string,
  prefix: string,
) {
  try {
    const url = new URL(value ?? "");
    return (
      url.protocol === "https:" &&
      url.hostname === host &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname.startsWith(prefix)
    );
  } catch {
    return false;
  }
}

/** A trusted alternate may recover a failed file; otherwise fail closed to the no-image UI. */
export function displayedDestinationImage(
  image: ImageAsset | null | undefined,
  fallback: ImageAsset | undefined,
  destinationId: string,
  failedSources: readonly string[] = [],
): ImageAsset | undefined {
  return (
    [image, fallback].find(
      (candidate) =>
        trustedDestinationImage(candidate, destinationId) &&
        !failedSources.includes(candidate.src),
    ) ?? undefined
  );
}
