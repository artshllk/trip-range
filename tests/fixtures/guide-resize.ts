import review from "../../docs/research/destination-media/launch-guide-resize-review.json";

export function beforeGuideResize<T extends { src: string }>(variants: T[]) {
  const added = new Set(
    review.assets.flatMap((asset) => asset.outputs.map((file) => file.src)),
  );
  return variants.filter((file) => !added.has(file.src));
}

export const guideWidths = [320, 640, 800, 1200, 1920];
