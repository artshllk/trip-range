import { approvedLandingKeys } from "./approved-keys";
import { landingPath } from "./identity";
export { originPath, weekendPath, budgetPath } from "./identity";
/** Client-safe reviewed allowlist; no generated origin/budget combinations. */
export function isEnglishLandingPath(path: string) {
  return approvedLandingKeys.some(
    (key) => landingPath(key) === path.replace(/\/$/, ""),
  );
}
