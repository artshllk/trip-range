import "server-only";
import { validateEnvironment } from "../../config/environment";
/** The only runtime process-environment reader. Never serialize this object. */
export function serverEnvironment() {
  // next.config embeds this nonsecret literal. Never use a dynamic lookup here:
  // runtime environment changes must not replace the build's deployment identity.
  return validateEnvironment(
    process.env,
    process.env.GOEKSPLO_NETLIFY_BUILD_CONTEXT ?? "",
  );
}
export function evidenceMode() {
  const mode = process.env.TRIP_RANGE_EVIDENCE_MODE;
  return mode === "candidate" || mode === "release" || mode === "accepted"
    ? mode
    : "off";
}

export function travelpayoutsEnvironment() {
  return serverEnvironment().travelpayouts;
}
export type AffiliateEnvironment = ReturnType<typeof travelpayoutsEnvironment>;
