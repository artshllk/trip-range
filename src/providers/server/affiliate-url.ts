import "server-only";
import type { AffiliateEnvironment } from "./environment";
import type { AffiliatePlacement } from "../../domain/affiliate";

export type AffiliateValidationReason =
  | "unsafe partner URL"
  | "API token in partner URL"
  | "unsupported partner host"
  | "unexpected path"
  | "unexpected query key"
  | "unexpected query value"
  | "destination mismatch"
  | "original URL normalization mismatch";
export type PartnerValidation = {
  reason: AffiliateValidationReason | null;
  partnerLinkHost: string | null;
  partnerPathShape: "/r" | "/:short-code" | "unexpected" | null;
};

function httpsUrl(value: unknown): URL | undefined {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    /[\s\\\u0000-\u001f\u007f]/.test(value) ||
    /(?:\/|%2f)(?:\.|%2e){1,2}(?:\/|%2f|$)/i.test(value.split(/[?#]/, 1)[0]) ||
    /%(?![a-f\d]{2})/i.test(value) ||
    !/^https:\/\//i.test(value)
  )
    return;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      value.includes("#")
    )
      return;
    return url;
  } catch {
    return;
  }
}

/** Only known equivalent search forms; no query, alternate route, date or party is ignored. */
function normalizedSearch(value: unknown): string | undefined {
  const url = httpsUrl(value);
  if (
    !url ||
    !["aviasales.com", "www.aviasales.com"].includes(url.hostname) ||
    url.search
  )
    return;
  // Decode unreserved characters only. Encoded slashes/delimiters and double encoding stay invalid.
  const path = url.pathname.replace(
    /%([a-f\d]{2})/gi,
    (encoded, hex: string) => {
      const char = String.fromCharCode(parseInt(hex, 16));
      return /[A-Za-z0-9_-]/.test(char) ? char : encoded;
    },
  );
  if (!/^\/search\/[A-Z]{3}\d{4}[A-Z]{3}\d{4}[1-9][0-8]?\/?$/.test(path))
    return;
  return path.replace(/\/$/, "");
}
export function equivalentAviasalesSearch(
  value: unknown,
  expected: string,
): boolean {
  const normalized = normalizedSearch(value);
  return !!normalized && normalized === normalizedSearch(expected);
}

export function validatePartnerUrl(
  value: unknown,
  env: AffiliateEnvironment,
  destinationUrl?: string,
  placement?: AffiliatePlacement,
): PartnerValidation {
  const result: PartnerValidation = {
    reason: null,
    partnerLinkHost: null,
    partnerPathShape: null,
  };
  const fail = (reason: AffiliateValidationReason) => ({ ...result, reason });
  const url = httpsUrl(value);
  if (!url || typeof value !== "string") return fail("unsafe partner URL");
  // Only the API token is secret. Inspect raw and decoded forms before exposing even a hostname.
  const token = env.TRAVELPAYOUTS_API_TOKEN?.trim();
  let decoded = value;
  for (let depth = 0; depth < 4; depth++) {
    if (token && (decoded.includes(token) || url.href.includes(token)))
      return fail("API token in partner URL");
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
      if (depth === 3) return fail("unsafe partner URL");
    } catch {
      return fail("unsafe partner URL");
    }
  }
  const short =
    url.hostname === "avs.io" ||
    // Also returned by the authenticated Partner Links API; allow this exact host only.
    url.hostname === "aviasales.tpo.lu" ||
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.tp\.st$/.test(url.hostname);
  result.partnerLinkHost = url.hostname;
  if (!short && url.hostname !== "tp.media")
    return fail("unsupported partner host");
  result.partnerPathShape =
    short && /^\/[a-zA-Z0-9_-]+$/.test(url.pathname)
      ? "/:short-code"
      : !short && url.pathname === "/r"
        ? "/r"
        : "unexpected";
  if (result.partnerPathShape === "unexpected") return fail("unexpected path");
  const allowed = new Set(
    short ? ["erid"] : ["marker", "trs", "p", "u", "campaign_id", "erid"],
  );
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) return fail("unexpected query key");
    if (url.searchParams.getAll(key).length !== 1 || !url.searchParams.get(key))
      return fail("unexpected query value");
  }
  const erid = url.searchParams.get("erid");
  if (erid && !/^[A-Za-z0-9_-]{1,256}$/.test(erid))
    return fail("unexpected query value");
  if (short) return result;

  // Documented Aviasales redirect: p=4114, campaign_id=100 (when present).
  // Travelpayouts appends the SubID to the marker with a dot.
  const marker = url.searchParams.get("marker");
  const expectedMarker = env.TRAVELPAYOUTS_MARKER;
  const subIds = placement
    ? [`${placement}_flight`]
    : ["results_flight", "trip_flight"];
  if (
    !expectedMarker ||
    !(
      marker === expectedMarker ||
      subIds.some((id) => marker === `${expectedMarker}.${id}`)
    ) ||
    (url.searchParams.has("trs") &&
      url.searchParams.get("trs") !== env.TRAVELPAYOUTS_PROJECT_ID) ||
    url.searchParams.get("p") !== "4114" ||
    (url.searchParams.has("campaign_id") &&
      url.searchParams.get("campaign_id") !== "100")
  )
    return fail("unexpected query value");
  // URLSearchParams performs the one outer decode. Do not follow redirects or decode another URL layer.
  if (
    !destinationUrl ||
    !equivalentAviasalesSearch(url.searchParams.get("u"), destinationUrl)
  )
    return fail("destination mismatch");
  return result;
}

export function safePartnerUrl(
  value: unknown,
  env: AffiliateEnvironment,
  destinationUrl?: string,
): value is string {
  return validatePartnerUrl(value, env, destinationUrl).reason === null;
}
