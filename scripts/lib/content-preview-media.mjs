/** Exact local review assets only; never imported by the product/runtime. */
import { resolve } from "node:path";
export function previewMediaFile(pathname) {
  if (!/^\/review-media\/(vienna|london)-(640|1200|1920)\.webp$/.test(pathname))
    return undefined;
  return resolve(
    "docs/research/destination-media/phase2",
    pathname.slice("/review-media/".length),
  );
}
