import type {
  ImageAsset,
  TravelLocation,
  TripRequest,
  TripStyle,
} from "./types";
import { decodeLocation } from "./locations";
import { findLocation } from "../catalogue/locations";
import { parseRequest, requestQuery, type Query } from "./request";
import { boundedSearchQuery } from "./request-limits";
import { primaryOriginId } from "./market/primary-origin";
import { isInactiveDestinationId } from "./destination-lifecycle";

/** Explicit collection, not automatic publication of every reviewed record. */
export const destinationCollection = [
  { slug: "vienna", subject: "vienna" },
  { slug: "london", subject: "london" },
  { slug: "paris", subject: "paris" },
  { slug: "new-york", subject: "place:Q60" },
  { slug: "istanbul", subject: "istanbul" },
  { slug: "barcelona", subject: "city:BCN" },
  { slug: "singapore", subject: "place:Q334" },
  { slug: "mexico-city", subject: "place:Q1489" },
  { slug: "tokyo", subject: "place:Q1490" },
  { slug: "kyoto", subject: "place:Q34600" },
  { slug: "bangkok", subject: "place:Q1861" },
  { slug: "marrakesh", subject: "place:Q101625" },
  { slug: "cape-town", subject: "place:Q5465" },
  { slug: "rio-de-janeiro", subject: "place:Q8678" },
  { slug: "sydney", subject: "place:Q3130" },
  { slug: "dubai", subject: "place:Q612" },
].filter((entry) => !isInactiveDestinationId(entry.subject));
export type DestinationCard = {
  slug: string;
  subject: string;
  name: string;
  country: string;
  countryCode: string;
  description: string;
  image?: ImageAsset;
};
export const discoveryStyles: {
  id: TripStyle;
  name: string;
  description: string;
}[] = [
  {
    id: "city",
    name: "City breaks",
    description: "Culture, neighbourhoods and time to explore.",
  },
  {
    id: "nature",
    name: "Outdoors",
    description: "Look for trips with nature in mind.",
  },
  {
    id: "quiet",
    name: "A slower pace",
    description: "Make room for a quieter trip.",
  },
  {
    id: "beach",
    name: "By the water",
    description: "Put some time by the sea on the wish list.",
  },
];

const contextKeys = new Set([
  "origin",
  "from",
  "originPlace",
  "budget",
  "currency",
  "adults",
  "children",
  "when",
  "start",
  "end",
  "nights",
  "flex",
  "flexDays",
  "dateMode",
  "month",
  "styles",
  "airports",
  "car",
  "luggage",
  "family",
  "stay",
  "scope",
  "noFlight",
  "toPlace",
  "arrival",
  "arrivalFor",
  "departure",
]);
/** Carry search inputs only, never arbitrary URL data or tracking/AI response fields. */
export function discoveryContext(query: Query): URLSearchParams {
  if (!boundedSearchQuery(query)) return new URLSearchParams();
  return new URLSearchParams(
    Object.entries(query).filter(
      (entry): entry is [string, string] =>
        contextKeys.has(entry[0]) && typeof entry[1] === "string",
    ),
  );
}
export function discoveryHref(path: string, query: Query, hash = ""): string {
  const params = discoveryContext(query).toString();
  return `${path}${params ? `?${params}` : ""}${hash ? `#${hash}` : ""}`;
}
/** Discovery has no inferred home airport. Normal results parsing remains unchanged. */
export function discoveryRequest(query: Query, today: string): TripRequest {
  const request = parseRequest(query, undefined, today);
  const origin =
    typeof query.originPlace === "string"
      ? decodeLocation(query.originPlace)
      : undefined;
  const selected =
    typeof query.origin === "string"
      ? query.origin
      : typeof query.from === "string"
        ? query.from
        : undefined;
  return origin || findLocation(selected)
    ? request
    : { ...request, originId: "", origin: undefined };
}
/** The homepage visibly prefills the primary market; explicit URL origins win.
 * Invalid explicit origins stay unresolved rather than switching the traveller. */
export function homepageRequest(query: Query, today: string): TripRequest {
  return discoveryRequest(
    query.origin === undefined &&
      query.from === undefined &&
      query.originPlace === undefined
      ? { ...query, origin: primaryOriginId }
      : query,
    today,
  );
}
export function discoveryRequestQuery(request: TripRequest): Query {
  const params = new URLSearchParams(requestQuery(request));
  if (!request.originId) params.delete("origin");
  return Object.fromEntries(params);
}
/** A city group is a search target, not a claim about the eventual operating airport. */
export function planDestinationHref(
  target: TravelLocation | undefined,
  query: Query,
): string {
  const params = discoveryContext(query);
  params.delete("toPlace");
  params.delete("arrival");
  params.delete("arrivalFor");
  if (target) {
    params.set("toPlace", JSON.stringify(target));
    params.set("scope", "anywhere");
    params.delete("arrival");
    params.delete("arrivalFor");
  }
  // English homepage is unprefixed.
  return `/${params.size ? `?${params}` : ""}#search`;
}
