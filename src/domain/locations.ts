import type { TravelLocation, Destination } from "./types";
import { locations } from "../catalogue/locations";
const code = (v: unknown, size = 3): v is string =>
  typeof v === "string" && new RegExp(`^[A-Z]{${size}}$`).test(v);
const label = (v: unknown): v is string =>
  typeof v === "string" &&
  v.trim().length > 0 &&
  v.length <= 120 &&
  !/[<>\x00-\x1f]/.test(v);
/** Validate public location snapshots from shareable URLs; never provider payloads. */
export function readLocation(value: unknown): TravelLocation | undefined {
  if (!value || typeof value !== "object") return;
  const v = value as Record<string, unknown>;
  if (
    !["city", "airport", "country"].includes(String(v.type)) ||
    !label(v.name) ||
    !code(v.countryCode, 2) ||
    !v.countryName ||
    typeof v.countryName !== "object"
  )
    return;
  const country = v.countryName as Record<string, unknown>;
  if (!label(country.en) || !label(country.sq)) return;
  const type = v.type as TravelLocation["type"];
  const cityCode = code(v.cityCode) ? v.cityCode : undefined;
  const airportIata = code(v.airportIata) ? v.airportIata : undefined;
  const known = locations.find((l) => l.id === v.id);
  // A canonical destination is a place, not an alias for one of its gateways.
  // This URL snapshot grants no access/airport authority; the server resolves it
  // against the reviewed destination-access registry before any provider query.
  const placeTarget =
    type === "city" &&
    typeof v.id === "string" &&
    /^place:Q[1-9]\d{0,11}$/.test(v.id) &&
    v.cityCode === undefined &&
    v.airportIata === undefined &&
    v.iataCodes === undefined;
  const expected =
    type === "country"
      ? `country:${v.countryCode}`
      : type === "airport"
        ? airportIata
          ? `airport:${airportIata}`
          : undefined
        : cityCode
          ? `city:${cityCode}`
          : undefined;
  if (!known && !placeTarget && (!expected || v.id !== expected)) return;
  let coordinates: TravelLocation["coordinates"];
  const c = v.coordinates as Record<string, unknown> | undefined;
  if (
    c &&
    typeof c.latitude === "number" &&
    typeof c.longitude === "number" &&
    Number.isFinite(c.latitude) &&
    Number.isFinite(c.longitude) &&
    Math.abs(c.latitude) <= 90 &&
    Math.abs(c.longitude) <= 180
  )
    coordinates = { latitude: c.latitude, longitude: c.longitude };
  if (known)
    return {
      ...known,
      ...(cityCode ? { cityCode } : {}),
      ...(coordinates ? { coordinates } : {}),
    };
  return {
    id: String(v.id),
    name: v.name,
    type,
    countryCode: v.countryCode,
    countryName: { en: country.en, sq: country.sq },
    cityCode,
    airportIata,
    iataCodes:
      type === "airport" ? [airportIata!] : cityCode ? [cityCode] : undefined,
    coordinates,
  };
}
export function decodeLocation(raw?: string) {
  if (!raw || raw.length > 1500) return;
  try {
    return readLocation(JSON.parse(raw));
  } catch {
    return;
  }
}
export function roadOriginId(location: TravelLocation) {
  if (["prishtina", "prizren", "skopje"].includes(location.id))
    return location.id;
  return ({ PRN: "prishtina", SKP: "skopje" } as Record<string, string>)[
    location.cityCode ?? location.airportIata ?? ""
  ];
}
export function matchesDestination(d: Destination, location?: TravelLocation) {
  if (!location) return true;
  if (location.type === "country")
    return d.countryCode === location.countryCode;
  return (
    d.id === location.id ||
    (location.iataCodes ?? []).some((c) => d.iataCodes?.includes(c)) ||
    (!!location.cityCode && !!d.iataCodes?.includes(location.cityCode))
  );
}
