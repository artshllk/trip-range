import { money } from "./money/currency";
import { planningCostPolicy } from "./money/planning-rates";
import type { Destination, TravelLocation } from "./types";
/** Deliberately retain the existing generic €180 standard room/two-night basis. No market-price claims. */

export function dynamicDestination(
  location: TravelLocation,
  codes: string[] = [],
  source = "location-selection",
): Destination {
  const id =
    location.type === "city"
      ? `city:${location.cityCode ?? location.iataCodes?.[0]}`
      : location.id;
  return {
    id,
    name: { en: location.name, sq: location.name },
    country: location.countryName,
    countryCode: location.countryCode,
    cityCode: location.cityCode,
    iataCodes: [
      ...new Set(
        [
          location.cityCode,
          location.airportIata,
          ...(location.iataCodes ?? []),
          ...codes,
        ].filter((c): c is string => !!c && /^[A-Z]{3}$/.test(c)),
      ),
    ],
    coordinates: location.coordinates,
    metadataSource: source,
    stylesKnown: false,
    styles: location.type === "city" ? ["city"] : [],
    requiresFlight: true,
    travelHours: 0,
    estimatedStay: money(planningCostPolicy.EUR.stayTwoNights, "EUR"),
    imageQuery: `${location.name} ${location.countryName.en}`,
    image: {
      src: "/demo/van-portrait.png",
      source: "local",
      sourceId: "dynamic-placeholder",
      author: null,
      attribution: "Illustrative local placeholder",
      license: null,
      destinationId: id,
      verification: "illustrative",
    },
    why: {
      en: "A travel idea with estimated non-flight costs. Check flight prices and final availability with the provider.",
      sq: "Një ide udhëtimi me vlerësime për kostot e tjera. Kontrollo çmimet e fluturimeve dhe disponueshmërinë me ofruesin.",
    },
  };
}
/** Curated identity/content wins; aliases only expand after trusted metadata resolution. */
export function registerDestination(
  catalogue: Destination[],
  resolved: Destination,
): Destination {
  const known = catalogue.find(
    (d) =>
      d.id === resolved.id ||
      (d.iataCodes ?? []).some((c) => resolved.iataCodes?.includes(c)),
  );
  if (known) {
    if (
      known.metadataSource === "location-selection" &&
      known.id !== resolved.id
    )
      Object.assign(known, resolved);
    known.iataCodes = [
      ...new Set([...(known.iataCodes ?? []), ...(resolved.iataCodes ?? [])]),
    ];
    return known;
  }
  catalogue.push(resolved);
  return resolved;
}
