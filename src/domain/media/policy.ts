export const MEDIA_POLICY_VERSION = "destination-media-v1";
/** Deliberately not an environment flag. A score can never authorize publication. */
export const AUTOMATIC_MEDIA_APPROVAL = false as const;
export const AUTOMATIC_MEDIA_INGESTION = false as const;
export const DESTINATION_MEDIA_ROLES = [
  "destination.card",
  "destination.hero",
] as const;
export const NONE_REASONS = [
  "unresolved-identity",
  "no-candidates",
  "all-rejected",
  "awaiting-review",
  "withdrawn",
] as const;
export { PLACE_KINDS } from "../places/policy";
