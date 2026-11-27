import type { PlaceMediaStore } from "../../domain/media/types";
import { validateMediaData } from "../../domain/media/validation";

/** Pure adapter core, also used by recorded component fixtures. Never fetches or discovers. */
export function createReviewedMediaStore(input: unknown): PlaceMediaStore {
  // A private snapshot prevents callers from mutating approval after validation.
  let parsed: ReturnType<typeof validateMediaData>;
  try {
    parsed = validateMediaData(JSON.parse(JSON.stringify(input)));
  } catch {
    parsed = { ok: false, errors: ["invalid-store"] };
  }
  const selections = new Map(
    parsed.ok
      ? parsed.data.selections.map((selection) => [
          `${selection.subject}|${selection.role}`,
          selection,
        ])
      : [],
  );
  const assets = new Map(
    parsed.ok ? parsed.data.assets.map((asset) => [asset.id, asset]) : [],
  );
  return {
    async get(subject, role) {
      if (!parsed.ok) return { status: "none", reason: "invalid-record" };
      const selection = selections.get(`${subject}|${role}`);
      if (!selection) return { status: "none", reason: "missing-selection" };
      if (selection.status === "none")
        return { status: "none", reason: selection.noneReason! };
      const asset = assets.get(selection.assetId!)!;
      const local = asset.localDelivery;
      const base = local?.variants.find((v) => v.src === local.src);
      return {
        status: "approved",
        image: {
          subject,
          role,
          assetId: asset.id,
          provider: asset.provider,
          providerFileId: asset.providerFileId,
          src: local?.src ?? asset.originalUrl!,
          ...(local
            ? {
                localVariants: local.variants.map(({ src, width, height }) => ({
                  src,
                  width,
                  height,
                })),
              }
            : {}),
          sourcePage: asset.sourcePage!,
          author: asset.author,
          attribution: asset.attribution,
          license: asset.license!.url,
          width: base?.width ?? asset.width,
          height: base?.height ?? asset.height,
          alt: { ...selection.alt! },
          focalPoint: { ...selection.focalPoint! },
          revision: selection.revision,
        },
      };
    },
  };
}
