import type { DisplayImage } from "../../domain/media/types";
import type { ImageAsset } from "../../domain/types";
/** Compatibility boundary: financial/trip contracts do not need provider response structures. */
export function displayImageAsset(image: DisplayImage): ImageAsset {
  return {
    src: image.src,
    source: image.localVariants ? "local" : "provider",
    ...(image.localVariants
      ? { localVariants: image.localVariants.map((v) => ({ ...v })) }
      : {}),
    sourceId: `${image.provider}:${image.providerFileId}`,
    destinationId: image.subject,
    verification: "verified",
    author: image.author,
    attribution: image.attribution.includes(image.author)
      ? image.attribution
      : `${image.attribution} — ${image.author}`,
    license: image.license,
    photoUrl: image.sourcePage,
    alt: image.alt.en,
    localizedAlt: { en: image.alt.en, sq: image.alt.sq ?? image.alt.en },
    focalPoint: image.focalPoint,
  };
}
