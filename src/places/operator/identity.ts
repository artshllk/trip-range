import type {
  Coordinates,
  ExternalIdentity,
  PlaceIdentity,
  PlaceInput,
  PlaceKind,
} from "../../domain/places/types";
import { PLACE_IDENTITY_POLICY_VERSION } from "../../domain/places/policy";
import {
  coordinatesValid,
  identityValid,
} from "../../domain/places/validation";

/** Normalized evidence only. Raw Wikibase claims stay in the adapter. */
export type PlaceEvidence = {
  external: ExternalIdentity;
  names: string[];
  countryCode: string;
  placeKind: PlaceKind;
  coordinates?: Coordinates;
  transportCodes: string[];
};
export const normalizedPlaceName = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export function distanceKm(a: Coordinates, b: Coordinates) {
  const radians = (n: number) => (n * Math.PI) / 180;
  const dLat = radians(b.latitude - a.latitude),
    dLon = radians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function unresolvedIdentity(
  input: PlaceInput,
  reason: string,
): PlaceIdentity {
  return {
    ...input,
    external: null,
    resolutionMethod: "unresolved",
    confidence: "unresolved",
    resolvedAt: null,
    unresolvedReason: reason,
    policyVersion: PLACE_IDENTITY_POLICY_VERSION,
  };
}
export function reviewedIdentity(input: PlaceInput, reviewed?: PlaceIdentity) {
  return reviewed &&
    identityValid(reviewed) &&
    reviewed.subject === input.subject &&
    reviewed.countryCode === input.countryCode &&
    reviewed.resolutionMethod === "reviewed"
    ? { ...reviewed }
    : undefined;
}
export const PLACE_RADIUS_KM: Readonly<Record<PlaceKind, number>> = {
  city: 30,
  island: 200,
  region: 150,
  "nature-area": 75,
  unknown: 25,
};
/** All constraints must agree and exactly one entity must survive. Never rank away ambiguity. */
export function resolvePlaceEvidence(
  input: PlaceInput,
  evidence: readonly PlaceEvidence[],
  method: "transport-code" | "constrained-name",
  now: string,
): PlaceIdentity {
  if (method === "constrained-name" && !coordinatesValid(input.coordinates))
    return unresolvedIdentity(
      input,
      "coordinates-required-for-name-resolution",
    );
  const codes = new Set(
    [input.cityCode, ...(input.iataCodes ?? [])].filter(Boolean),
  );
  const matches = evidence.filter(
    (e) =>
      e.placeKind !== "unknown" &&
      e.countryCode === input.countryCode &&
      (input.placeKind === "unknown" || input.placeKind === e.placeKind) &&
      e.names.some(
        (n) => normalizedPlaceName(n) === normalizedPlaceName(input.name),
      ) &&
      (method !== "transport-code" ||
        e.transportCodes.some((c) => codes.has(c))) &&
      (!input.coordinates ||
        (coordinatesValid(e.coordinates) &&
          distanceKm(input.coordinates, e.coordinates!) <=
            PLACE_RADIUS_KM[e.placeKind])),
  );
  const unique = [
    ...new Map(
      matches.map((e) => [`${e.external.authority}:${e.external.id}`, e]),
    ).values(),
  ];
  if (unique.length !== 1)
    return unresolvedIdentity(
      input,
      unique.length ? "ambiguous-identity" : "insufficient-identity-evidence",
    );
  const entity = unique[0];
  return {
    ...input,
    placeKind: entity.placeKind,
    external: entity.external,
    resolutionMethod: method,
    confidence: "high",
    resolvedAt: now,
    unresolvedReason: null,
    policyVersion: PLACE_IDENTITY_POLICY_VERSION,
  };
}
