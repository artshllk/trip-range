/**
 * Offline transform: one city's room-observation round (the entry form's
 * downloaded JSON, unchanged) plus the research validator's report → a candidate
 * anchor figure for human review.
 *
 * Never runs per request. The app reads only figures a person has marked
 * reviewed (see stay-figures.ts). The research validator
 * (docs/research/room-observation-round-2026-11/validate.mjs, run through
 * check.mjs) stays the authority on which stays are eligible; this transform
 * refuses any round it has not passed, re-checks the invariants it depends on,
 * and must reproduce the validator's own medians to the cent.
 */
import { isCalendarDate, nightsBetween } from "../dates";
import type { DestinationCostId } from "./types";

export const ROOM_PANEL_METHOD = "room-panel-v8-displayed-rate" as const;
export const ROOM_PANEL_TRANSFORM = "room-panel-median-v1" as const;

/**
 * Provisional band by sample size (spec "Statistic"): editorial, not a confidence
 * interval, until the holdout run replaces it with measured widths.
 * The band depends on how many stays of the thinner type contribute:
 * 8 → ±25%, 7 → ±30%, 6 → ±35%, 5 → ±40%, 4 → ±45%; fewer than 4 → no figure.
 * London's six stays per type are its complete panel; it is ±35% because six is a
 * smaller sample than eight, not because anything is missing.
 */
export const ROOM_PANEL_BAND = {
  minimumPerStayType: 4,
  maximumPerStayType: 8,
  percentAtEight: 25,
  percentPerStayFewer: 5,
} as const;
export const ROOM_PANEL_BAND_BY_SAMPLE: Readonly<Record<number, number>> = {
  8: 25,
  7: 30,
  6: 35,
  5: 40,
  4: 45,
};

export function roomPanelBandPercent(
  weekday: number,
  weekend: number,
): number | undefined {
  const n = roomPanelSampleSize(weekday, weekend);
  return n === undefined ? undefined : ROOM_PANEL_BAND_BY_SAMPLE[n];
}
/** The thinner stay type's contributing count, when the panel is usable at all. */
export function roomPanelSampleSize(
  weekday: number,
  weekend: number,
): number | undefined {
  const b = ROOM_PANEL_BAND;
  if (
    ![weekday, weekend].every(
      (n) => Number.isSafeInteger(n) && n >= 0 && n <= b.maximumPerStayType,
    )
  )
    return undefined;
  const least = Math.min(weekday, weekend);
  return least < b.minimumPerStayType ? undefined : least;
}

/** First-round panels. Tirana and Prishtina join when they have frozen panels. */
export const ROOM_PANEL_CITIES = {
  vienna: { destinationId: "city:VIE", countryCode: "AT", properties: 8 },
  milan: { destinationId: "city:MIL", countryCode: "IT", properties: 8 },
  barcelona: { destinationId: "city:BCN", countryCode: "ES", properties: 8 },
  istanbul: { destinationId: "city:IST", countryCode: "TR", properties: 8 },
  london: { destinationId: "city:LON", countryCode: "GB", properties: 6 },
} as const satisfies Record<
  string,
  { destinationId: DestinationCostId; countryCode: string; properties: number }
>;
export type RoomPanelCity = keyof typeof ROOM_PANEL_CITIES;
const isPanelCity = (v: unknown): v is RoomPanelCity =>
  typeof v === "string" &&
  Object.prototype.hasOwnProperty.call(ROOM_PANEL_CITIES, v);

/** One stay as the entry form writes it. Fields not used here pass through untouched. */
export type RoomObservationSample = {
  method_version: string;
  composition_id: string;
  property_id: string;
  property_name: string;
  stay_type: string;
  classification_basis: string;
  check_in: string;
  check_out: string;
  lead_days: number;
  adults: number;
  children: number;
  rooms: number;
  currency: string;
  outcome: string;
  displayed_total: string;
  lodging_tax_treatment: string;
  stated_tax_total: string;
  conditional_charge_treatment: string;
  conditional_charge_amount: string;
  cancellation: string;
  meal_basis: string;
  [field: string]: unknown;
};
/** The entry form's download: the template plus the form's own `coverage`, which is ignored here. */
export type RoomObservationRound = {
  method_version: string;
  city: string;
  currency: string;
  composition_id: string;
  observation_date: string;
  comparison_context?: Record<string, unknown>;
  observer: string;
  session: Record<string, unknown>;
  samples: RoomObservationSample[];
  coverage?: unknown;
  [field: string]: unknown;
};
/** check.mjs stdout (validateRound + evidence checks + summarizeForReview). */
export type RoomPanelCheckReport = {
  ready: boolean;
  errors: string[];
  samples: {
    property_id: string;
    stay_type: string;
    contributes: boolean;
    tax_treatment: string | null;
    errors: string[];
  }[];
  panel_for_review?: {
    weekday_two_night_median_minor: number;
    weekend_two_night_median_minor: number;
    standard_room_night_minor: number;
  } | null;
  [field: string]: unknown;
};

type StayType = "weekday" | "weekend";
type TaxTreatment = "stated_included" | "stated_extra" | "page_silent";
const TAX: readonly TaxTreatment[] = [
  "stated_included",
  "stated_extra",
  "page_silent",
];
export type RoomPanelStaySummary = {
  checkIn: string;
  checkOut: string;
  contributing: number;
  medianTwoNightCents: number;
  /** Review only; one outlier moves it, so it never feeds a figure. */
  meanTwoNightCents: number;
};
export type RoomPanelFigure = {
  schemaVersion: 1;
  /** `{city}-{observationDate}-{compositionId}`: the provenance ID every derived figure cites. */
  id: string;
  method: typeof ROOM_PANEL_METHOD;
  transform: typeof ROOM_PANEL_TRANSFORM;
  city: RoomPanelCity;
  destinationId: DestinationCostId;
  countryCode: string;
  currency: "EUR";
  compositionId: string;
  observationDate: string;
  /** Set by the reviewer when deriving; the figure is withdrawn after it. */
  reviewAfter: string;
  review:
    | { status: "pending" }
    | { status: "reviewed"; reviewer: string; reviewedAt: string };
  weekday: RoomPanelStaySummary;
  weekend: RoomPanelStaySummary;
  /** Equal stay-type weight, two nights each, rounded once: (weekday + weekend) / 4. */
  roomNightCents: number;
  bandPercent: number;
  properties: { inPanel: number; contributing: number };
  taxTreatments: Record<TaxTreatment, number>;
  /** Contributors with an exact hotel-stated whole-stay tax. Review only. */
  statedTaxAmounts: number;
  /**
   * Contributing stays priced on a permitted fallback rate. Breakfast-included
   * stays make a breakfast-included figure; the card says so.
   */
  fallbacks: { breakfastIncluded: number; nonRefundable: number };
  classificationBasis: "independent" | "operator_declared" | "mixed";
  comparisonContext?: Record<string, unknown>;
  /** Per-stay inputs, for the round-to-round review diff. */
  contributors: {
    propertyId: string;
    stayType: StayType;
    twoNightCents: number;
    tax: TaxTreatment;
    mealBasis: "room_only" | "breakfast_fallback";
    cancellation: "free" | "nonrefundable_fallback";
  }[];
  /** Every frozen slot that did not contribute, kept, never substituted. */
  excluded: { propertyId: string; stayType: StayType; outcome: string }[];
};
export type RoomPanelResult =
  | { ok: true; figure: RoomPanelFigure }
  | { ok: false; errors: string[] };

/** Same grammar as the entry form: positive decimal, at most two places, no separators. */
export function parseMinor(text: unknown): number | undefined {
  if (typeof text !== "string" || !/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(text))
    return undefined;
  const [whole, fraction = ""] = text.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
const nights = (a: unknown, b: unknown) =>
  isCalendarDate(a) && isCalendarDate(b) ? nightsBetween(a, b) : NaN;
/** Same convention as summarizeForReview: mean of the two middle values when even. */
function median(sorted: readonly number[]) {
  return (
    (sorted[Math.floor((sorted.length - 1) / 2)] +
      sorted[Math.floor(sorted.length / 2)]) /
    2
  );
}

export function deriveRoomPanel(
  round: RoomObservationRound,
  report: RoomPanelCheckReport,
  review: { reviewAfter: string },
): RoomPanelResult {
  const errors: string[] = [];
  const fail = (m: string) => errors.push(m);
  if (!round || typeof round !== "object" || !Array.isArray(round.samples))
    return { ok: false, errors: ["Expected an entry-form round file."] };
  if (!report || report.ready !== true || report.errors?.length)
    return {
      ok: false,
      errors: [
        "The research check has not passed this round; nothing is derived.",
        ...(report?.errors ?? []),
      ],
    };
  const city = round.city;
  if (!isPanelCity(city)) return { ok: false, errors: ["Unknown panel city."] };
  const panel = ROOM_PANEL_CITIES[city];
  if (round.method_version !== ROOM_PANEL_METHOD)
    fail(
      "Method version differs; rounds from different methods are never mixed.",
    );
  if (round.currency !== "EUR") fail("Rounds are recorded in displayed EUR.");
  if (!isCalendarDate(round.observation_date))
    fail("Invalid observation date.");
  if (typeof round.composition_id !== "string" || !round.composition_id)
    fail("Missing composition ID.");
  const days = nights(round.observation_date, review?.reviewAfter);
  if (!(days >= 1 && days <= 120))
    fail("reviewAfter must fall 1–120 days after the observation date.");

  const slots = new Map<string, RoomObservationSample>();
  for (const s of round.samples) {
    const key = `${s?.property_id}/${s?.stay_type}`;
    if (slots.has(key)) fail(`Duplicate slot ${key}.`);
    slots.set(key, s);
  }
  if (
    slots.size !== panel.properties * 2 ||
    report.samples.length !== slots.size
  )
    fail(
      `Expected ${panel.properties * 2} frozen slots in both the round and the check report.`,
    );

  const contributors: RoomPanelFigure["contributors"] = [];
  const excluded: RoomPanelFigure["excluded"] = [];
  const stays: Partial<
    Record<StayType, { checkIn: string; checkOut: string }>
  > = {};
  const classification = new Set<string>();
  let statedTaxAmounts = 0;
  for (const r of report.samples) {
    const key = `${r.property_id}/${r.stay_type}`;
    const s = slots.get(key);
    if (!s || (r.stay_type !== "weekday" && r.stay_type !== "weekend")) {
      fail(`Check report slot ${key} is not in the round.`);
      continue;
    }
    const type: StayType = r.stay_type;
    classification.add(s.classification_basis);
    const dates = { checkIn: s.check_in, checkOut: s.check_out };
    const known = stays[type];
    if (!known) stays[type] = dates;
    else if (
      known.checkIn !== dates.checkIn ||
      known.checkOut !== dates.checkOut
    )
      fail(`${key}: stay dates differ within one stay type.`);
    if (!r.contributes) {
      excluded.push({
        propertyId: r.property_id,
        stayType: type,
        outcome: s.outcome || "blank",
      });
      continue;
    }
    // Invariants this transform relies on. The validator already enforces them;
    // a disagreement means the report and the file do not belong together.
    const total = parseMinor(s.displayed_total);
    const embedded =
      s.conditional_charge_treatment === "embedded_itemized"
        ? parseMinor(s.conditional_charge_amount)
        : 0;
    const tax = s.lodging_tax_treatment as TaxTreatment;
    if (
      s.outcome !== "quote" ||
      s.method_version !== ROOM_PANEL_METHOD ||
      s.composition_id !== round.composition_id ||
      s.currency !== "EUR" ||
      s.adults !== 2 ||
      s.children !== 0 ||
      s.rooms !== 1 ||
      nights(s.check_in, s.check_out) !== 2 ||
      !TAX.includes(tax) ||
      r.tax_treatment !== tax ||
      !["confirmed_none", "separate", "embedded_itemized"].includes(
        s.conditional_charge_treatment,
      ) ||
      (s.meal_basis !== "room_only" && s.meal_basis !== "breakfast_fallback") ||
      (s.cancellation !== "free" &&
        s.cancellation !== "nonrefundable_fallback") ||
      total === undefined ||
      embedded === undefined ||
      !(total - embedded > 0)
    ) {
      fail(
        `${key}: marked contributing but the stay does not meet the transform's invariants.`,
      );
      continue;
    }
    if (s.stated_tax_total) statedTaxAmounts++;
    // A separate property-dependent charge is already outside the displayed total;
    // an itemized embedded one is taken out, as the research summary does.
    contributors.push({
      propertyId: r.property_id,
      stayType: type,
      twoNightCents: total - embedded,
      tax,
      mealBasis: s.meal_basis as "room_only" | "breakfast_fallback",
      cancellation: s.cancellation as "free" | "nonrefundable_fallback",
    });
  }
  const summary = (type: StayType): RoomPanelStaySummary | undefined => {
    const values = contributors
      .filter((c) => c.stayType === type)
      .map((c) => c.twoNightCents)
      .sort((a, b) => a - b);
    const dates = stays[type];
    if (!values.length || !dates) return undefined;
    return {
      ...dates,
      contributing: values.length,
      medianTwoNightCents: median(values),
      meanTwoNightCents: Math.round(
        values.reduce((a, b) => a + b, 0) / values.length,
      ),
    };
  };
  const weekday = summary("weekday"),
    weekend = summary("weekend");
  const band = roomPanelBandPercent(
    weekday?.contributing ?? 0,
    weekend?.contributing ?? 0,
  );
  if (!weekday || !weekend || band === undefined)
    fail(
      "At least four contributing weekday AND four weekend stays are required.",
    );
  if (errors.length || !weekday || !weekend || band === undefined)
    return { ok: false, errors };
  const roomNightCents = Math.round(
    (weekday.medianTwoNightCents + weekend.medianTwoNightCents) / 4,
  );
  const research = report.panel_for_review;
  if (
    !research ||
    research.weekday_two_night_median_minor !== weekday.medianTwoNightCents ||
    research.weekend_two_night_median_minor !== weekend.medianTwoNightCents ||
    research.standard_room_night_minor !== roomNightCents
  )
    return {
      ok: false,
      errors: [
        "This transform and the research summary disagree; resolve before review.",
      ],
    };
  const basis = [...classification];
  return {
    ok: true,
    figure: {
      schemaVersion: 1,
      id: `${city}-${round.observation_date}-${round.composition_id}`,
      method: ROOM_PANEL_METHOD,
      transform: ROOM_PANEL_TRANSFORM,
      city,
      destinationId: panel.destinationId,
      countryCode: panel.countryCode,
      currency: "EUR",
      compositionId: round.composition_id,
      observationDate: round.observation_date,
      reviewAfter: review.reviewAfter,
      review: { status: "pending" },
      weekday,
      weekend,
      roomNightCents,
      bandPercent: band,
      properties: {
        inPanel: panel.properties,
        contributing: new Set(contributors.map((c) => c.propertyId)).size,
      },
      taxTreatments: Object.fromEntries(
        TAX.map((t) => [t, contributors.filter((c) => c.tax === t).length]),
      ) as Record<TaxTreatment, number>,
      statedTaxAmounts,
      fallbacks: {
        breakfastIncluded: contributors.filter(
          (c) => c.mealBasis === "breakfast_fallback",
        ).length,
        nonRefundable: contributors.filter(
          (c) => c.cancellation === "nonrefundable_fallback",
        ).length,
      },
      classificationBasis:
        basis.length === 1 &&
        (basis[0] === "independent" || basis[0] === "operator_declared")
          ? basis[0]
          : "mixed",
      ...(round.comparison_context
        ? { comparisonContext: round.comparison_context }
        : {}),
      contributors,
      excluded,
    },
  };
}

/** Registry gate: shape, arithmetic and an explicit human review. Throws on any defect. */
export function validateRoomPanelFigure(f: RoomPanelFigure): void {
  const ok =
    f?.schemaVersion === 1 &&
    f.method === ROOM_PANEL_METHOD &&
    f.transform === ROOM_PANEL_TRANSFORM &&
    isPanelCity(f.city) &&
    f.destinationId === ROOM_PANEL_CITIES[f.city].destinationId &&
    f.countryCode === ROOM_PANEL_CITIES[f.city].countryCode &&
    f.currency === "EUR" &&
    f.id === `${f.city}-${f.observationDate}-${f.compositionId}` &&
    isCalendarDate(f.observationDate) &&
    isCalendarDate(f.reviewAfter) &&
    f.observationDate < f.reviewAfter &&
    f.review?.status === "reviewed" &&
    typeof f.review.reviewer === "string" &&
    f.review.reviewer.trim().length > 0 &&
    isCalendarDate(f.review.reviewedAt) &&
    f.review.reviewedAt >= f.observationDate &&
    f.review.reviewedAt <= f.reviewAfter &&
    f.bandPercent ===
      roomPanelBandPercent(f.weekday.contributing, f.weekend.contributing) &&
    f.contributors.length === f.weekday.contributing + f.weekend.contributing &&
    f.fallbacks?.breakfastIncluded ===
      f.contributors.filter((c) => c.mealBasis === "breakfast_fallback")
        .length &&
    f.fallbacks.nonRefundable ===
      f.contributors.filter((c) => c.cancellation === "nonrefundable_fallback")
        .length &&
    f.contributors.length + f.excluded.length ===
      ROOM_PANEL_CITIES[f.city].properties * 2 &&
    Number.isSafeInteger(f.roomNightCents) &&
    f.roomNightCents > 0 &&
    f.roomNightCents ===
      Math.round(
        (f.weekday.medianTwoNightCents + f.weekend.medianTwoNightCents) / 4,
      );
  if (!ok) throw Error(`Invalid or unreviewed room panel figure ${f?.id}`);
}
