import { spanishFlightCities } from "./spain-municipalities";
import { flightDestinations } from "../catalogue/flight-destinations";
// Reviewed OurAirports-derived names (public domain); see scripts/flight-city-names.mjs.
import flightCityNames from "./flight-city-names.json";

const additional: Record<string, [string, string, string]> = {
  BCN: ["Barcelona", "ES", "Spain"],
  ANK: ["Ankara", "TR", "Türkiye"],
  AYT: ["Antalya", "TR", "Türkiye"],
  BEG: ["Belgrade", "RS", "Serbia"],
  BRU: ["Brussels", "BE", "Belgium"],
  BTS: ["Bratislava", "SK", "Slovakia"],
  EIN: ["Eindhoven", "NL", "Netherlands"],
  PEG: ["Perugia", "IT", "Italy"],
  STR: ["Stuttgart", "DE", "Germany"],
  ZTH: ["Zakynthos", "GR", "Greece"],
  AER: ["Sochi", "RU", "Russia"],
  AMS: ["Amsterdam", "NL", "Netherlands"],
  ATH: ["Athens", "GR", "Greece"],
  BLQ: ["Bologna", "IT", "Italy"],
  BRI: ["Bari", "IT", "Italy"],
  BUD: ["Budapest", "HU", "Hungary"],
  CGN: ["Cologne", "DE", "Germany"],
  CTA: ["Catania", "IT", "Italy"],
  DUS: ["Düsseldorf", "DE", "Germany"],
  FLR: ["Florence", "IT", "Italy"],
  GOA: ["Genoa", "IT", "Italy"],
  LYS: ["Lyon", "FR", "France"],
  MAD: ["Madrid", "ES", "Spain"],
  MLA: ["Malta", "MT", "Malta"],
  PRG: ["Prague", "CZ", "Czechia"],
  RMI: ["Rimini", "IT", "Italy"],
  VRN: ["Verona", "IT", "Italy"],
  WAW: ["Warsaw", "PL", "Poland"],
  TRN: ["Turin", "IT", "Italy"],
  PSA: ["Pisa", "IT", "Italy"],
  NAP: ["Naples", "IT", "Italy"],
  TSF: ["Venice", "IT", "Italy"],
  VCE: ["Venice", "IT", "Italy"],
  FMM: ["Memmingen", "DE", "Germany"],
};

export function monthPlace(code: string) {
  const city = flightDestinations.find((d) => d.iataCodes?.includes(code));
  if (city)
    return {
      name: city.name.en,
      country: city.country.en,
      countryCode: city.countryCode,
    };
  if (spanishFlightCities[code])
    return {
      name: spanishFlightCities[code],
      countryCode: "ES",
      country: "Spain",
    };
  const place =
    additional[code] ??
    (flightCityNames.places as Record<string, string[]>)[code];
  return place
    ? { name: place[0], countryCode: place[1], country: place[2] }
    : undefined;
}
