import "server-only";
import {
  isExcludedTravelDestination,
  isExcludedTravelDestinationId,
} from "../../domain/destination-lifecycle";
import type { DestinationResolver } from "../contracts";
import type { Destination } from "../../domain/types";
import { readLocation } from "../../domain/locations";
import {
  dynamicDestination,
  registerDestination,
} from "../../domain/dynamic-destinations";
import { providerJson, record, type ProviderFetch } from "./http";
export const DESTINATION_METADATA_TTL = 7 * 86400;
export const MAX_DESTINATION_LOOKUPS = 10;
export const METADATA_CONCURRENCY = 4;
/** Exact code matching only. Airport coordinates are not mislabeled as city coordinates. */
export function destinationMetadata(
  body: unknown,
  code: string,
): Destination | undefined {
  if (!Array.isArray(body) || !/^[A-Z]{3}$/.test(code)) return;
  const matches = body
    .slice(0, 40)
    .filter(
      (v) =>
        record(v) &&
        v.code === code &&
        ["city", "airport"].includes(String(v.type)),
    );
  const normalized = matches.flatMap((v) => {
    const cityCode = v.type === "city" ? v.code : v.city_code;
    const name = v.type === "city" ? v.name : v.city_name;
    if (
      typeof cityCode !== "string" ||
      !/^[A-Z]{3}$/.test(cityCode) ||
      typeof name !== "string" ||
      /^[A-Z]{3}$/.test(name)
    )
      return [];
    const city = readLocation({
      id: `city:${cityCode}`,
      type: "city",
      cityCode,
      name,
      countryCode: v.country_code,
      countryName: { en: v.country_name, sq: v.country_name },
      coordinates:
        v.type === "city" && record(v.coordinates)
          ? { latitude: v.coordinates.lat, longitude: v.coordinates.lon }
          : undefined,
    });
    return city
      ? [dynamicDestination(city, [code], "travelpayouts-autocomplete")]
      : [];
  });
  if (
    !normalized.length ||
    normalized.length !== matches.length ||
    new Set(normalized.map((d) => `${d.id}:${d.countryCode}:${d.name.en}`))
      .size !== 1
  )
    return;
  const coordinates = normalized.flatMap((d) =>
    d.coordinates ? [d.coordinates] : [],
  );
  if (new Set(coordinates.map((c) => `${c.latitude}:${c.longitude}`)).size > 1)
    return;
  const destination = { ...normalized[0], coordinates: coordinates[0] };
  return isExcludedTravelDestination(destination) ? undefined : destination;
}
/** One resolver per search: total budget includes detail restore; public code-only requests use Next Data Cache. */
export function createDestinationResolver(
  catalogue: Destination[],
  fetcher: ProviderFetch = fetch,
): DestinationResolver {
  const attempted = new Map<string, Promise<Destination | undefined>>();
  return {
    async resolve(codes) {
      const selected = [...new Set(codes)]
        .filter(
          (c) =>
            /^[A-Z]{3}$/.test(c) && !isExcludedTravelDestinationId(`city:${c}`),
        )
        .slice(0, MAX_DESTINATION_LOOKUPS);
      let cursor = 0;
      const resolved = new Map<string, Destination>();
      await Promise.all(
        Array.from(
          { length: Math.min(METADATA_CONCURRENCY, selected.length) },
          async () => {
            while (cursor < selected.length) {
              const code = selected[cursor++];
              let pending = attempted.get(code);
              if (!pending && attempted.size < MAX_DESTINATION_LOOKUPS) {
                pending = (async () => {
                  const url = new URL(
                    "https://autocomplete.travelpayouts.com/places2",
                  );
                  url.search = new URLSearchParams({
                    term: code,
                    locale: "en",
                  }).toString();
                  url.searchParams.append("types[]", "city");
                  url.searchParams.append("types[]", "airport");
                  const response = await providerJson(
                    url.toString(),
                    { Accept: "application/json" },
                    DESTINATION_METADATA_TTL,
                    fetcher,
                    2500,
                  );
                  const destination = response.ok
                    ? destinationMetadata(response.body, code)
                    : undefined;
                  return destination;
                })();
                attempted.set(code, pending);
              }
              try {
                const d = await pending;
                if (d) resolved.set(code, d);
              } catch {}
            }
          },
        ),
      );
      // Register in query order, not network completion order. Conflicting aliases fail closed.
      const results: Destination[] = [];
      for (const code of selected) {
        const d = resolved.get(code);
        if (!d) continue;
        const peers = [...resolved.values()].filter(
          (other) => other.id === d.id,
        );
        if (
          peers.some(
            (other) =>
              other.countryCode !== d.countryCode ||
              other.name.en !== d.name.en ||
              (other.coordinates &&
                d.coordinates &&
                JSON.stringify(other.coordinates) !==
                  JSON.stringify(d.coordinates)),
          )
        )
          continue;
        const known = catalogue.find(
          (other) =>
            other.id === d.id ||
            other.iataCodes?.some((c) => d.iataCodes?.includes(c)),
        );
        if (known && known.countryCode !== d.countryCode) continue;
        const registered = registerDestination(catalogue, d);
        if (!results.some((r) => r.id === registered.id))
          results.push(registered);
      }
      return results;
    },
  };
}
