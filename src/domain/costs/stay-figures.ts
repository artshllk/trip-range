/**
 * Which stay figure, if any, a destination gets from reviewed room panels and the
 * Eurostat price-level snapshot. Undefined means "no figure": the caller keeps the
 * existing labelled planning allowance and says so.
 *
 * Observed figures are used as observed, unchanged, until the next quarterly round
 * replaces them (no HICP roll-forward; see eurostat.ts).
 */
import { isCalendarDate } from "../dates";
import { money, type CurrencyCode, type MoneyAmount } from "../money/currency";
import type { Destination, LocalizedText } from "../types";
import type { PanelEvidence } from "../panel-lodging-tax";
import {
  eurostatGeo,
  nearestByPriceLevel,
  priceLevelFactor,
  stayCoverage,
  validateEurostatSeries,
  type EurostatSeries,
  type PriceLevelFactor,
} from "./eurostat";
import {
  measuredWidth,
  SCALED_USEFUL_MAX_PERCENT,
  validateHoldout,
  type HoldoutResult,
} from "./holdout";
import { destinationCostId } from "./identity";
import {
  ROOM_PANEL_CITIES,
  ROOM_PANEL_METHOD,
  roomPanelBandPercent,
  roomPanelSampleSize,
  validateRoomPanelFigure,
  type RoomPanelCity,
  type RoomPanelFigure,
} from "./room-panel";

/**
 * Labelled placeholder until the holdout run (scheduled 18 Nov 2026) measures the
 * scaled error: added to the anchor's sample-size band, so a scaled figure is
 * always wider than the figure it came from. Not a measured error.
 */
export const SCALED_BAND_PLACEHOLDER = 25;

export type ScalingAnchor = RoomPanelCity | "tirana";
export const ANCHOR_NAMES: Record<ScalingAnchor, LocalizedText> = {
  vienna: { en: "Vienna", sq: "Vjena" },
  milan: { en: "Milan", sq: "Milano" },
  barcelona: { en: "Barcelona", sq: "Barcelona" },
  istanbul: { en: "Istanbul", sq: "Stambolli" },
  london: { en: "London", sq: "Londra" },
  tirana: { en: "Tirana", sq: "Tirana" },
};
/** Anchors other cities can be scaled from, by country. London and Prishtina cannot. */
export const SCALABLE_ANCHORS: Readonly<Record<string, ScalingAnchor>> = {
  AT: "vienna",
  IT: "milan",
  ES: "barcelona",
  TR: "istanbul",
  AL: "tirana",
};
/**
 * Owner-decided groups (spec "Why these", 2026-10-28), kept as decided even where a
 * price-level comparison would pick differently (Germany is nearer Italy's level).
 * Every other covered country is assigned by nearestByPriceLevel among
 * SCALABLE_ANCHORS: computed from the snapshot, never hand-assigned. Assignment does
 * not depend on which anchors currently have a figure, so a missing panel never
 * silently moves a country to another anchor.
 */
export const DECIDED_ANCHOR_BY_COUNTRY: Readonly<
  Record<string, ScalingAnchor>
> = {
  AT: "vienna",
  DE: "vienna",
  CZ: "vienna",
  HU: "vienna",
  SK: "vienna",
  SI: "vienna",
  CH: "vienna", // spec: "Zürich and Geneva: scaled from Vienna"
  AL: "tirana",
  MK: "tirana",
  ME: "tirana",
  RS: "tirana",
  BA: "tirana",
  IT: "milan",
  ES: "barcelona",
  TR: "istanbul",
};

export type StayData = {
  figures: readonly RoomPanelFigure[];
  series?: EurostatSeries;
  /** Reviewed leave-one-out result; replaces the provisional bands when present. */
  holdout?: HoldoutResult;
};
export type AnchorAssignment =
  | { method: "decided" }
  | { method: "nearest-price-level"; year: number };
export type StayFigure = {
  kind: "observed" | "scaled";
  anchor: RoomPanelFigure;
  /** Standard room-night, EUR: observed as is, or scaled once and rounded. */
  roomNight: MoneyAmount;
  bandPercent: number;
  /** "editorial-placeholder" until a reviewed holdout measures it from at least three errors. */
  band: "measured" | "editorial-placeholder";
  /** Independent held-out errors behind a measured band. */
  bandN?: number;
  /** Scaled figures only. */
  priceLevel?: PriceLevelFactor;
  assignment?: AnchorAssignment;
};

export function validateStayData(data: StayData): void {
  const ids = new Set<string>();
  for (const f of data.figures) {
    validateRoomPanelFigure(f);
    if (ids.has(f.id)) throw Error(`Duplicate room panel figure ${f.id}`);
    ids.add(f.id);
  }
  if (data.series) validateEurostatSeries(data.series);
  if (data.holdout) validateHoldout(data.holdout);
}

function currentFigure(data: StayData, city: RoomPanelCity, today: string) {
  return data.figures
    .filter(
      (f) =>
        f.city === city &&
        f.review.status === "reviewed" &&
        f.review.reviewedAt <= today &&
        today <= f.reviewAfter,
    )
    .sort((a, b) => b.observationDate.localeCompare(a.observationDate))[0];
}
const isPanelCity = (v: string | undefined): v is RoomPanelCity =>
  !!v && Object.prototype.hasOwnProperty.call(ROOM_PANEL_CITIES, v);

/** The anchor a covered country scales from, and how that was decided. */
export function scalingAnchor(
  countryCode: string,
  series: EurostatSeries | undefined,
  today: string,
): { anchor: ScalingAnchor; assignment: AnchorAssignment } | undefined {
  const decided = DECIDED_ANCHOR_BY_COUNTRY[countryCode];
  if (decided) return { anchor: decided, assignment: { method: "decided" } };
  const near = nearestByPriceLevel(
    series?.priceLevels,
    countryCode,
    Object.keys(SCALABLE_ANCHORS),
    today,
  );
  const country =
    near &&
    Object.keys(SCALABLE_ANCHORS).find(
      (c) => eurostatGeo(c) === near.anchorGeo,
    );
  return country
    ? {
        anchor: SCALABLE_ANCHORS[country],
        assignment: { method: "nearest-price-level", year: near.year },
      }
    : undefined;
}

export function resolveStayFigure(
  destination: Destination,
  currency: CurrencyCode,
  today: string | undefined,
  data: StayData,
): StayFigure | undefined {
  // Figures are displayed EUR. No FX conversion of observed prices.
  if (currency !== "EUR" || !isCalendarDate(today)) return undefined;
  const id = destinationCostId(destination);
  if (!id) return undefined;
  const coverage = stayCoverage(destination.countryCode, id);
  if (coverage === "outside") return undefined;
  const holdout =
    data.holdout?.review.status === "reviewed" ? data.holdout : undefined;
  const own = (Object.keys(ROOM_PANEL_CITIES) as RoomPanelCity[]).find(
    (c) =>
      ROOM_PANEL_CITIES[c].destinationId === id &&
      ROOM_PANEL_CITIES[c].countryCode === destination.countryCode,
  );
  if (own) {
    // An anchor without a current figure is withdrawn, never scaled from a neighbour.
    const anchor = currentFigure(data, own, today);
    if (!anchor) return undefined;
    const n = roomPanelSampleSize(
      anchor.weekday.contributing,
      anchor.weekend.contributing,
    )!;
    const measured = measuredWidth(holdout, n);
    return {
      kind: "observed",
      anchor,
      roomNight: money(anchor.roomNightCents, "EUR"),
      bandPercent: measured?.percent ?? anchor.bandPercent,
      ...(measured
        ? { band: "measured", bandN: measured.n }
        : { band: "editorial-placeholder" }),
    };
  }
  if (coverage !== "full" || !id.startsWith("city:")) return undefined;
  const assigned = scalingAnchor(destination.countryCode, data.series, today);
  if (!assigned || !isPanelCity(assigned.anchor)) return undefined;
  const anchor = currentFigure(data, assigned.anchor, today);
  if (!anchor) return undefined;
  const priceLevel = priceLevelFactor(
    data.series?.priceLevels,
    anchor.countryCode,
    destination.countryCode,
    today,
  );
  if (!priceLevel) return undefined;
  const n = roomPanelSampleSize(
    anchor.weekday.contributing,
    anchor.weekend.contributing,
  )!;
  const measured = measuredWidth(holdout, n);
  // Spec validation rule: a measured scaled error this wide leaves stay anchor-only.
  if (measured && measured.percent > SCALED_USEFUL_MAX_PERCENT)
    return undefined;
  const cents = Math.round(anchor.roomNightCents * priceLevel.ratio);
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 1_000_000)
    return undefined;
  return {
    kind: "scaled",
    anchor,
    roomNight: money(cents, "EUR"),
    bandPercent:
      measured?.percent ??
      roomPanelBandPercent(
        anchor.weekday.contributing,
        anchor.weekend.contributing,
      )! + SCALED_BAND_PLACEHOLDER,
    ...(measured
      ? { band: "measured" as const, bandN: measured.n }
      : { band: "editorial-placeholder" as const }),
    priceLevel,
    assignment: assigned.assignment,
  };
}

/** Binds the figure to this destination for the lodging-tax resolver. */
export function stayFigureEvidence(
  figure: StayFigure,
  destination: Destination,
): PanelEvidence {
  const a = figure.anchor;
  if (a.review.status !== "reviewed") throw Error("Unreviewed figure");
  return {
    method: ROOM_PANEL_METHOD,
    destinationId: destination.id,
    countryCode: destination.countryCode,
    sourceId: a.id,
    checkedDate: a.review.reviewedAt,
    reviewAfter: a.reviewAfter,
    weekday: a.weekday.contributing,
    weekend: a.weekend.contributing,
    included: a.taxTreatments.stated_included,
    extra: a.taxTreatments.stated_extra,
    silent: a.taxTreatments.page_silent,
    bandPercent: figure.bandPercent,
    ...(figure.kind === "scaled" ? { scaledFrom: { anchorId: a.id } } : {}),
  };
}

/** Everything the card needs to name the basis. No prices beyond the figure itself. */
export type StayFigureSummary = {
  kind: StayFigure["kind"];
  anchorId: string;
  anchorName: LocalizedText;
  properties: number;
  weekday: number;
  weekend: number;
  stayMonth: string;
  observationDate: string;
  bandPercent: number;
  band: StayFigure["band"];
  bandN?: number;
  /** Share of contributing stays on each permitted fallback rate. */
  fallbacks: {
    breakfastIncluded: number;
    nonRefundable: number;
    contributing: number;
  };
  priceLevel?: Pick<PriceLevelFactor, "year" | "provisional" | "retrievedAt">;
  assignment?: AnchorAssignment;
};
export function summarizeStayFigure(f: StayFigure): StayFigureSummary {
  const a = f.anchor;
  return {
    kind: f.kind,
    anchorId: a.id,
    anchorName: ANCHOR_NAMES[a.city],
    properties: a.properties.contributing,
    weekday: a.weekday.contributing,
    weekend: a.weekend.contributing,
    stayMonth: a.weekday.checkIn.slice(0, 7),
    observationDate: a.observationDate,
    bandPercent: f.bandPercent,
    band: f.band,
    ...(f.bandN ? { bandN: f.bandN } : {}),
    fallbacks: { ...a.fallbacks, contributing: a.contributors.length },
    ...(f.priceLevel
      ? {
          priceLevel: {
            year: f.priceLevel.year,
            provisional: f.priceLevel.provisional,
            retrievedAt: f.priceLevel.retrievedAt,
          },
        }
      : {}),
    ...(f.assignment ? { assignment: f.assignment } : {}),
  };
}
