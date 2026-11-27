import "server-only";
import type { LocationSearch } from "../contracts";
import type { TravelLocation } from "../../domain/types";
import { locations } from "../../catalogue/locations";
import { flightDestinations } from "../../catalogue/flight-destinations";
import { readLocation } from "../../domain/locations";
import { providerJson, record, type ProviderFetch } from "./http";
export const LOCATION_LIMIT = 8;
export function normalizeLocation(value: unknown): TravelLocation | undefined {
  if (
    !record(value) ||
    !["city", "airport", "country"].includes(String(value.type))
  )
    return;
  const type = String(value.type);
  const known =
    type === "city"
      ? locations.find((l) => l.iataCodes?.includes(String(value.code)))
      : undefined;
  const normalized = readLocation({
    id: `${type}:${value.code}`,
    type,
    name: value.name,
    countryCode:
      value.country_code ?? (type === "country" ? value.code : undefined),
    countryName: {
      en: value.country_name ?? value.name,
      sq: value.country_name ?? value.name,
    },
    cityCode: type === "city" ? value.code : value.city_code,
    airportIata: type === "airport" ? value.code : undefined,
    coordinates: record(value.coordinates)
      ? { latitude: value.coordinates.lat, longitude: value.coordinates.lon }
      : undefined,
  });
  return known && normalized
    ? {
        ...normalized,
        ...known,
        cityCode: normalized.cityCode,
        coordinates: normalized.coordinates,
      }
    : normalized;
}
export function createLocationSearch(
  fetcher: ProviderFetch = fetch,
): LocationSearch {
  return {
    async search(term) {
      const q = term.trim();
      if (q.length < 2 || q.length > 80)
        return { locations: [], status: "available" };
      const local: TravelLocation[] = [
        ...locations,
        ...flightDestinations.map(
          (d) =>
            locations.find((l) => l.iataCodes?.includes(d.iataCodes![0])) ?? {
              id: `city:${d.iataCodes![0]}`,
              name: d.name.en,
              countryCode: d.countryCode,
              countryName: d.country,
              type: "city" as const,
              cityCode: d.iataCodes![0],
              iataCodes: d.iataCodes,
            },
        ),
      ].filter(
        (l) =>
          l.name.toLowerCase().includes(q.toLowerCase()) ||
          l.iataCodes?.includes(q.toUpperCase()),
      );
      const url = new URL("https://autocomplete.travelpayouts.com/places2");
      url.searchParams.set("term", q);
      url.searchParams.set("locale", "en");
      for (const type of ["city", "airport", "country"])
        url.searchParams.append("types[]", type);
      const result = await providerJson(
        url.toString(),
        { Accept: "application/json" },
        86400,
        fetcher,
        2500,
      );
      const remote =
        result.ok && Array.isArray(result.body)
          ? result.body.slice(0, 40).flatMap((v) => {
              const l = normalizeLocation(v);
              return l ? [l] : [];
            })
          : [];
      const unique = new Map([...local, ...remote].map((l) => [l.id, l]));
      return {
        locations: [...unique.values()].slice(0, LOCATION_LIMIT),
        status:
          result.ok && Array.isArray(result.body) ? "available" : "unavailable",
      };
    },
  };
}
