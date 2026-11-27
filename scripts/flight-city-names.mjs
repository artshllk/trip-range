// Generates src/domain/flight-city-names.json: traveller-facing city and country names
// for destination codes the fare store returns but the site's curated tables lack.
//
// Source: OurAirports (https://ourairports.com), data repository
// https://github.com/davidmegginson/ourairports-data released under the Unlicense
// ("free and unencumbered software released into the public domain"). Travelpayouts
// city data was not used: its redistribution terms could not be confirmed.
//
// Usage (data files are downloaded separately and never committed):
//   node scripts/flight-city-names.mjs <airports.csv> <countries.csv> <codes.json> > src/domain/flight-city-names.json
// codes.json maps each destination code to the airports seen for it in the store,
// e.g. {"BUH": ["BBU", "OTP"]}. OurAirports lists airports only, so metropolitan
// codes (BUH, STO, NYC) resolve through their airports. Municipality is often a
// suburb or includes a region, so every generated entry was reviewed; corrections
// are recorded below and win over the source.
import { readFileSync } from "node:fs";

/** Reviewed 23 November 2026. [name] or [name, countryCode]. */
const overrides = {
  AGA: ["Agadir"],
  ALY: ["Alexandria", "EG"], // no OurAirports match for the city code
  AOI: ["Ancona"],
  BHX: ["Birmingham"],
  BJL: ["Banjul"],
  BOB: ["Bora Bora"],
  BZO: ["Bolzano"],
  CAN: ["Guangzhou"],
  CFU: ["Corfu"],
  COV: ["Adana"],
  CSX: ["Changsha"],
  DOM: ["Dominica"],
  DPS: ["Bali"],
  EAP: ["Basel", "CH"], // EuroAirport Basel–Mulhouse–Freiburg, sited in France
  ECN: ["Ercan"],
  EDI: ["Edinburgh"],
  FKB: ["Karlsruhe/Baden-Baden"],
  FMO: ["Münster/Osnabrück"],
  GOI: ["Goa"],
  HEL: ["Helsinki"],
  IAS: ["Iași"],
  INV: ["Inverness"],
  IZM: ["İzmir", "TR"], // OurAirports' IZM is Selçuk; the store's IZM flights use ADB
  JER: ["Jersey"],
  JTR: ["Santorini"],
  KRK: ["Kraków"],
  KUL: ["Kuala Lumpur"],
  KUT: ["Kutaisi"],
  LED: ["Saint Petersburg"],
  LEJ: ["Leipzig"],
  LJU: ["Ljubljana"],
  MAN: ["Manchester"],
  MNL: ["Manila"],
  MRS: ["Marseille"],
  MRV: ["Mineralnye Vody"],
  NCE: ["Nice"],
  NYC: ["New York"],
  ONT: ["Ontario (California)"],
  OSL: ["Oslo"],
  OST: ["Ostend"],
  PMF: ["Parma"],
  PXO: ["Porto Santo"],
  RMO: ["Chișinău"],
  SDZ: ["Shetland"],
  SHA: ["Shanghai"],
  SKP: ["Skopje"],
  SUF: ["Lamezia Terme"],
  SYD: ["Sydney"],
  SZY: ["Olsztyn"],
  SZZ: ["Szczecin"],
  TLS: ["Toulouse"],
  TRS: ["Trieste"],
  ULY: ["Ulyanovsk"],
  WAS: ["Washington"],
  YXU: ["London, Ontario"],
};
const storeAirportsFirst = new Set(["IZM"]);
/** Country names as the site already writes them. */
const countryNames = { TR: "Türkiye", CZ: "Czechia" };

function csv(path) {
  const [head, ...lines] = readFileSync(path, "utf8").trim().split("\n");
  const split = (line) => {
    const out = [];
    let cell = "",
      quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"' && line[i + 1] === '"' && quoted) {
        cell += '"';
        i++;
      } else if (c === '"') quoted = !quoted;
      else if (c === "," && !quoted) {
        out.push(cell);
        cell = "";
      } else cell += c;
    }
    out.push(cell.replace(/\r$/, ""));
    return out;
  };
  const keys = split(head);
  return lines.map((l) =>
    Object.fromEntries(split(l).map((v, i) => [keys[i], v])),
  );
}

const [airportsCsv, countriesCsv, codesJson] = process.argv.slice(2);
if (!codesJson) {
  console.error(
    "Usage: flight-city-names.mjs <airports.csv> <countries.csv> <codes.json>",
  );
  process.exit(2);
}
const byIata = new Map();
for (const a of csv(airportsCsv))
  if (a.iata_code)
    byIata.set(a.iata_code, [...(byIata.get(a.iata_code) ?? []), a]);
const country = Object.fromEntries(
  csv(countriesCsv).map((c) => [c.code, c.name]),
);
const codes = JSON.parse(readFileSync(codesJson, "utf8"));

const places = {};
for (const [code, airports] of Object.entries(codes).sort()) {
  const fix = overrides[code];
  const rank = (a) =>
    (a.scheduled_service === "yes" ? 0 : 2) +
    (a.type === "large_airport" ? 0 : 1);
  // City codes that are also some other airport's IATA code resolve through the
  // airports actually seen in the store.
  const lookup =
    storeAirportsFirst.has(code) || !byIata.has(code) ? airports : [code];
  const source = lookup
    .flatMap((iata) => byIata.get(iata) ?? [])
    .sort((a, b) => rank(a) - rank(b))[0];
  const name = fix?.[0] ?? source?.municipality;
  const cc = fix?.[1] ?? source?.iso_country;
  if (!name || !cc || !country[cc]) {
    console.error(`unresolved: ${code}`);
    process.exitCode = 1;
    continue;
  }
  places[code] = [name, cc, countryNames[cc] ?? country[cc]];
}
process.stdout.write(
  JSON.stringify(
    {
      source:
        "OurAirports (ourairports.com) via github.com/davidmegginson/ourairports-data, Unlicense (public domain); reviewed overrides in scripts/flight-city-names.mjs",
      generated: new Date().toISOString().slice(0, 10),
      places,
    },
    null,
    2,
  ) + "\n",
);
