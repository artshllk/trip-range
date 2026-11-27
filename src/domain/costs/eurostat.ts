/**
 * Eurostat layer 2 of the non-flight cost model (docs/specs/non-flight-cost-model.md):
 * cross-country scaling by price level (prc_ppp_ind_1, A0111, PLI_EU27_2020).
 * Pure arithmetic over a versioned snapshot a person has approved; no network.
 *
 * No HICP roll-forward (owner decision 2026-11-04): an observed figure stands
 * unchanged until the next quarterly round replaces it. The non-seasonally-adjusted
 * hotel index would read seasonal swings as inflation. Seasonality is a separate
 * future feature that needs seasonally adjusted data.
 *
 * Reuse (Eurostat copyright notice, Decision 2011/833/EU): every page that shows a
 * figure derived here must carry EUROSTAT_ATTRIBUTION. UK, US and JP rows are
 * OECD-computed and never used.
 */
import { isCalendarDate } from "../dates";

const EU27 = [
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
] as const;
/** ISO 3166 country codes with a Eurostat price level. */
export const FULL_COVERAGE_COUNTRIES: readonly string[] = [
  ...EU27,
  "IS",
  "NO",
  "CH",
  "AL",
  "BA",
  "ME",
  "MK",
  "RS",
  "TR",
];
export type StayCoverage =
  | "full" // observed or scaled by price level
  | "anchor-only" // Prishtina, London: observed figure only, never scaled from or to
  | "outside";
/** Coverage is per destination: Kosovo and the UK each have exactly one covered city. */
export function stayCoverage(
  countryCode: string,
  destinationId?: string,
): StayCoverage {
  if (FULL_COVERAGE_COUNTRIES.includes(countryCode)) return "full";
  if (countryCode === "XK" && destinationId === "city:PRN")
    return "anchor-only";
  if (countryCode === "GB" && destinationId === "city:LON")
    return "anchor-only";
  return "outside";
}
/** Eurostat's geo codes differ from ISO for Greece only among covered countries. */
export function eurostatGeo(countryCode: string): string {
  return countryCode === "GR" ? "EL" : countryCode;
}

export type PriceLevelSnapshot = {
  dataset: "prc_ppp_ind_1";
  indicator: "PLI_EU27_2020";
  category: "A0111";
  /** Eurostat's dataset "last updated" date for this snapshot. */
  updated: string;
  /** When we downloaded it (the citation's access date). */
  retrievedAt: string;
  sourceUrl: string;
  /** The converter writes "pending"; a person sets "reviewed" after checking the diff. */
  reviewStatus: "pending" | "reviewed";
  /** One value per country and reference year. `provisional` mirrors Eurostat's "p" flag. */
  values: { geo: string; year: number; value: number; provisional?: boolean }[];
};
export type EurostatSeries = { priceLevels: PriceLevelSnapshot };

/** Spec: a price-level release older than 15 months moves scaled figures to Overdue.
 * Overdue widening is not built, so this withdraws them instead. */
export const PRICE_LEVEL_MAX_AGE_MONTHS = 15;

const monthsBetween = (from: string, to: string) =>
  (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
  Number(to.slice(5, 7)) -
  Number(from.slice(5, 7));
const positive = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

/** A usable snapshot today, or undefined. */
function current(snapshot: PriceLevelSnapshot | undefined, today: string) {
  return snapshot &&
    isCalendarDate(today) &&
    isCalendarDate(snapshot.updated) &&
    snapshot.updated <= today &&
    monthsBetween(snapshot.updated, today) <= PRICE_LEVEL_MAX_AGE_MONTHS
    ? snapshot
    : undefined;
}

export type PriceLevelFactor = {
  dataset: "prc_ppp_ind_1";
  category: "A0111";
  year: number;
  provisional: boolean;
  anchorGeo: string;
  anchorValue: number;
  geo: string;
  value: number;
  ratio: number;
  updated: string;
  retrievedAt: string;
};
/** Destination ÷ anchor, from the latest reference year both countries publish. */
export function priceLevelFactor(
  snapshot: PriceLevelSnapshot | undefined,
  anchorCountry: string,
  destinationCountry: string,
  today: string,
): PriceLevelFactor | undefined {
  const s = current(snapshot, today);
  if (
    !s ||
    !FULL_COVERAGE_COUNTRIES.includes(anchorCountry) ||
    !FULL_COVERAGE_COUNTRIES.includes(destinationCountry)
  )
    return undefined;
  const anchorGeo = eurostatGeo(anchorCountry),
    geo = eurostatGeo(destinationCountry);
  const years = (g: string) =>
    new Map(
      s.values
        .filter((v) => v.geo === g && positive(v.value))
        .map((v) => [v.year, v]),
    );
  const a = years(anchorGeo),
    d = years(geo);
  const year = Math.max(...[...a.keys()].filter((y) => d.has(y)));
  if (!Number.isSafeInteger(year)) return undefined;
  const av = a.get(year)!,
    dv = d.get(year)!;
  return {
    dataset: "prc_ppp_ind_1",
    category: "A0111",
    year,
    provisional: Boolean(av.provisional || dv.provisional),
    anchorGeo,
    anchorValue: av.value,
    geo,
    value: dv.value,
    ratio: dv.value / av.value,
    updated: s.updated,
    retrievedAt: s.retrievedAt,
  };
}

/**
 * Of the candidate anchor countries, the one whose price level is closest to the
 * destination's: smallest |ln(destination ÷ anchor)|, i.e. the scaling ratio
 * nearest 1, from each pair's latest common year. Ties go to the lower country
 * code. Computed, never hand-assigned.
 */
export function nearestByPriceLevel(
  snapshot: PriceLevelSnapshot | undefined,
  destinationCountry: string,
  candidateCountries: readonly string[],
  today: string,
): PriceLevelFactor | undefined {
  return candidateCountries
    .map((c) => priceLevelFactor(snapshot, c, destinationCountry, today))
    .filter((f): f is PriceLevelFactor => !!f)
    .sort(
      (a, b) =>
        Math.abs(Math.log(a.ratio)) - Math.abs(Math.log(b.ratio)) ||
        a.anchorGeo.localeCompare(b.anchorGeo),
    )[0];
}

export function validateEurostatSeries(series: EurostatSeries): void {
  const pli = series?.priceLevels;
  const ok =
    pli?.dataset === "prc_ppp_ind_1" &&
    pli.indicator === "PLI_EU27_2020" &&
    pli.category === "A0111" &&
    pli.reviewStatus === "reviewed" &&
    isCalendarDate(pli.updated) &&
    isCalendarDate(pli.retrievedAt) &&
    pli.updated <= pli.retrievedAt &&
    /^https:\/\/ec\.europa\.eu\//.test(pli.sourceUrl) &&
    pli.values.every(
      (v) =>
        !["UK", "US", "JP"].includes(v.geo) &&
        Number.isSafeInteger(v.year) &&
        positive(v.value),
    ) &&
    new Set(pli.values.map((v) => `${v.geo}/${v.year}`)).size ===
      pli.values.length;
  if (!ok) throw Error("Invalid or unreviewed Eurostat snapshot");
}

/** Citation required beside any figure scaled with this series. */
export const EUROSTAT_ATTRIBUTION = {
  en: "Source: Eurostat (prc_ppp_ind_1), accessed {date}. Modified by Trip Range; Eurostat bears no responsibility for these estimates.",
  sq: "Burimi: Eurostat (prc_ppp_ind_1), qasur më {date}. Përpunuar nga GoEksplo; Eurostat nuk mban përgjegjësi për këto vlerësime.",
} as const;
