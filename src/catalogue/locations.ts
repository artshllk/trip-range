import type { TravelLocation } from "../domain/types";

/** Phase 1.5 catalogue boundary. Adding a location is data, not a domain type change. */
export const locations: readonly TravelLocation[] = [
  {
    id: "tirana",
    name: "Tirana",
    countryCode: "AL",
    countryName: { en: "Albania", sq: "Shqipëri" },
    type: "city",
    iataCodes: ["TIA"],
  },
  {
    id: "prishtina",
    name: "Prishtina",
    countryCode: "XK",
    countryName: { en: "Kosovo", sq: "Kosovë" },
    type: "city",
    iataCodes: ["PRN"],
  },
  {
    id: "prizren",
    name: "Prizren",
    countryCode: "XK",
    countryName: { en: "Kosovo", sq: "Kosovë" },
    type: "city",
  },
  {
    id: "skopje",
    name: "Skopje",
    countryCode: "MK",
    countryName: { en: "North Macedonia", sq: "Maqedoninë e Veriut" },
    type: "city",
    iataCodes: ["SKP"],
  },
  {
    id: "zurich",
    name: "Zurich",
    countryCode: "CH",
    countryName: { en: "Switzerland", sq: "Zvicër" },
    type: "city",
    iataCodes: ["ZRH"],
  },
];
export function findLocation(value: string | undefined, catalogue = locations) {
  return catalogue.find(
    (l) => l.id === value || l.name.toLowerCase() === value?.toLowerCase(),
  );
}
export function locationName(id: string) {
  return findLocation(id)?.name ?? id;
}
export function domesticLabel(id: string, locale: "en" | "sq") {
  const location = findLocation(id);
  if (location?.countryCode === "XK")
    return locale === "sq" ? "Brenda Kosovës" : "Inside Kosovo";
  const name = location?.countryName[locale];
  return name
    ? locale === "sq"
      ? `Brenda në ${name}`
      : `Inside ${name}`
    : locale === "sq"
      ? "Brenda vendit"
      : "Within your country";
}
