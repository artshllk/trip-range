/** Exact municipality identities, not airport catchment areas. No fuzzy matching. */
export function municipalityNames(name: string): string[] {
  return name.split("/").map((part) => {
    const reordered = part.replace(/^(.+),\s*(El|La|Las|Los|A|O)$/i, "$2 $1");
    return reordered
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  });
}
const aliases: Record<string, string> = {
  "la coruna": "A Coruña",
  seville: "Sevilla",
  "palma de mallorca": "Palma",
  "las palmas": "Las Palmas de Gran Canaria",
};
export function sameSpanishMunicipality(
  source: string,
  destination: string,
): boolean {
  const names = municipalityNames(destination).flatMap((n) =>
    municipalityNames(aliases[n] ?? n),
  );
  return municipalityNames(source).some((n) => names.includes(n));
}

/** Provider city identities verified against Travelpayouts' public city dictionary
 * on 20 November 2026 (https://api.travelpayouts.com/data/en/cities.json).
 * Includes destinations without an INE rate. Asturias/Tenerife remain a region/
 * island: no rate is borrowed from an airport's nearby municipality. */
export const spanishFlightCities: Record<string, string> = {
  ABC: "Albacete",
  ACE: "Arrecife",
  AEI: "Algeciras",
  AGP: "Malaga",
  ALC: "Alicante",
  AMR: "Almeria",
  BCN: "Barcelona",
  BIO: "Bilbao",
  BJZ: "Badajoz",
  CDT: "Castellon de la Plana",
  CDZ: "Cadiz",
  CEJ: "Cuenca",
  CQM: "Ciudad Real",
  EAS: "San Sebastian",
  EEL: "Tudela",
  FES: "San Fernando",
  FGR: "Fuengirola",
  FUE: "Puerto del Rosario",
  GEN: "Puente Genil",
  GGA: "La Graciosa",
  GMZ: "San Sebastian de la Gomera",
  GRO: "Girona",
  GRX: "Granada",
  HEV: "Huelva",
  HSK: "Huesca",
  IBZ: "Ibiza",
  ILD: "Lleida",
  JCU: "Ceuta",
  LCG: "La Coruna",
  LEI: "Almeria",
  LEN: "Leon",
  LEU: "Seo de Urgel",
  LPA: "Las Palmas",
  MAD: "Madrid",
  MAH: "Menorca",
  MLN: "Melilla",
  NDO: "La Palma Del Condado",
  ODB: "Cordoba",
  OVD: "Asturias",
  OZI: "Bobadilla",
  OZL: "Orzola",
  OZP: "Moron",
  OZU: "Montilla",
  PMI: "Palma",
  PNA: "Pamplona",
  PXS: "Puerto De Santa Maria",
  QGN: "Tarragona",
  REU: "Reus",
  RGS: "Burgos",
  RJL: "Logrono",
  RMU: "Murcia",
  ROZ: "Rota",
  RRA: "Ronda",
  SCQ: "Santiago De Compostela",
  SDR: "Santander",
  SLM: "Salamanca",
  SPC: "Santa Cruz De La Palma",
  SPO: "San Pablo",
  SVQ: "Sevilla",
  TCI: "Tenerife",
  UER: "Puertollano",
  UTL: "Torremolinos",
  VDE: "Valverde",
  VGO: "Vigo",
  VIT: "Vitoria-Gasteiz",
  VLC: "Valencia",
  VLL: "Valladolid",
  XJO: "Soria",
  XJR: "Lorca",
  XOU: "Segovia",
  XRY: "Jerez de la Frontera",
  XTJ: "Toledo",
  XUF: "Cartagena",
  ZAZ: "Zaragoza",
  ZRC: "San Pedro de Alcantara",
};
