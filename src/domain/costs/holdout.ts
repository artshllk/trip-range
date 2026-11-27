/**
 * Leave-one-out holdout (spec "Validation before shipping", 1): predict each anchor
 * from its neighbour through the price-level layer and measure the error, at full
 * and reduced donor sample sizes. Its reviewed result replaces both provisional
 * margins: the sample-size band (±25% at eight…) and the scaled placeholder (+25).
 *
 * Offline analysis. The app reads only a reviewed result.
 */
import { isCalendarDate } from "../dates";
import {
  eurostatGeo,
  nearestByPriceLevel,
  priceLevelFactor,
  type PriceLevelSnapshot,
} from "./eurostat";
/** Mirrors SCALED_BAND_PLACEHOLDER in stay-figures.ts (kept here to avoid an import cycle). */
const SCALED_PLACEHOLDER_POINTS = 25;
import {
  ROOM_PANEL_BAND,
  ROOM_PANEL_BAND_BY_SAMPLE,
  roomPanelSampleSize,
  type RoomPanelCity,
  type RoomPanelFigure,
} from "./room-panel";

export const HOLDOUT_METHOD = "room-panel-holdout-v1" as const;
/**
 * Fewer independent held-out errors than this and nothing is measured: a band from
 * two or three points only looks like a measurement. Those bands keep their
 * editorial placeholder, labelled as such. Applies to every city, London included.
 */
export const MIN_HOLDOUT_PAIRS = 3;
/** Spec proposal: a measured scaled error wider than this leaves stay anchor-only. */
export const SCALED_USEFUL_MAX_PERCENT = 35;
/** London has no price level: it can be neither predicted nor a donor. */
const UNSCALABLE: ReadonlySet<RoomPanelCity> = new Set(["london"]);

type Error3 = { observedCents: number; predictedCents: number; error: number };
export type HoldoutPair = {
  heldOut: string;
  donor: string;
  priceLevelYear: number;
  ratio: number;
  /** Equal weekday/weekend weight, both from full panels. */
  roomNight: Error3;
  weekday: Error3;
  weekend: Error3;
};
export type HoldoutBand = {
  sampleSize: number;
  /** Independent held-out anchors whose donor had this many stays per type. */
  n: number;
  observed: { percent: number; source: "measured" | "editorial-placeholder" };
  scaled: { percent: number; source: "measured" | "editorial-placeholder" };
};
export type HoldoutResult = {
  schemaVersion: 1;
  method: typeof HOLDOUT_METHOD;
  runDate: string;
  priceLevelsUpdated: string;
  figureIds: string[];
  pairs: HoldoutPair[];
  /** p80 of |error| by donor sample size (contributing stays per type), whole % rounded up. */
  widths: Record<
    string,
    { percent: number; heldOutAnchors: number; predictions: number }
  >;
  unsupported: number[];
  /**
   * Every band, measured or not, with its n (independent held-out anchors). Plain
   * record of what this run replaced and what still rests on editorial judgment.
   */
  bands: HoldoutBand[];
  review:
    | { status: "pending" }
    | { status: "reviewed"; reviewer: string; reviewedAt: string };
};

const median = (sorted: readonly number[]) =>
  (sorted[Math.floor((sorted.length - 1) / 2)] +
    sorted[Math.floor(sorted.length / 2)]) /
  2;
function* combinations(
  values: readonly number[],
  k: number,
  start = 0,
  picked: number[] = [],
): Generator<number[]> {
  if (picked.length === k) {
    yield picked;
    return;
  }
  for (let i = start; i <= values.length - (k - picked.length); i++)
    yield* combinations(values, k, i + 1, [...picked, values[i]]);
}
/** Nearest-rank percentile with per-value weights. */
function weightedPercentile(
  rows: { value: number; weight: number }[],
  p: number,
) {
  const sorted = [...rows].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((s, r) => s + r.weight, 0);
  let seen = 0;
  for (const r of sorted) {
    seen += r.weight;
    if (seen >= p * total - 1e-12) return r.value;
  }
  return sorted[sorted.length - 1].value;
}
const stays = (f: RoomPanelFigure, type: "weekday" | "weekend") =>
  f.contributors
    .filter((c) => c.stayType === type)
    .map((c) => c.twoNightCents)
    .sort((a, b) => a - b);

export function runHoldout(
  figures: readonly RoomPanelFigure[],
  priceLevels: PriceLevelSnapshot,
  runDate: string,
): HoldoutResult {
  if (!isCalendarDate(runDate)) throw Error("Invalid run date");
  const usable = figures.filter(
    (f) =>
      !UNSCALABLE.has(f.city) &&
      priceLevelFactor(priceLevels, f.countryCode, f.countryCode, runDate),
  );
  if (new Set(usable.map((f) => f.city)).size !== usable.length)
    throw Error("One figure per anchor: pass a single round.");
  const pairs: HoldoutPair[] = [];
  const byK = new Map<
    number,
    { value: number; weight: number; heldOut: string }[]
  >();
  for (const held of usable) {
    const others = usable.filter((f) => f !== held);
    const near = nearestByPriceLevel(
      priceLevels,
      held.countryCode,
      others.map((f) => f.countryCode),
      runDate,
    );
    const donor =
      near && others.find((f) => eurostatGeo(f.countryCode) === near.anchorGeo);
    if (!near || !donor) continue;
    const err = (observed: number, predicted: number): Error3 => ({
      observedCents: observed,
      predictedCents: Math.round(predicted),
      error: (predicted - observed) / observed,
    });
    pairs.push({
      heldOut: held.id,
      donor: donor.id,
      priceLevelYear: near.year,
      ratio: near.ratio,
      roomNight: err(held.roomNightCents, donor.roomNightCents * near.ratio),
      weekday: err(
        held.weekday.medianTwoNightCents,
        donor.weekday.medianTwoNightCents * near.ratio,
      ),
      weekend: err(
        held.weekend.medianTwoNightCents,
        donor.weekend.medianTwoNightCents * near.ratio,
      ),
    });
    // Reduced donor coverage: every subset of k stays per type, equal type weights.
    const wd = stays(donor, "weekday"),
      we = stays(donor, "weekend");
    for (
      let k = ROOM_PANEL_BAND.minimumPerStayType;
      k <= Math.min(wd.length, we.length);
      k++
    ) {
      const wdMedians = [...combinations(wd, k)].map(median);
      const weMedians = [...combinations(we, k)].map(median);
      const weight = 1 / (wdMedians.length * weMedians.length); // each held-out anchor counts once
      const rows = byK.get(k) ?? [];
      for (const a of wdMedians)
        for (const b of weMedians)
          rows.push({
            value: Math.abs(
              (((a + b) / 4) * near.ratio - held.roomNightCents) /
                held.roomNightCents,
            ),
            weight,
            heldOut: held.id,
          });
      byK.set(k, rows);
    }
  }
  const widths: HoldoutResult["widths"] = {};
  const unsupported: number[] = [];
  const bands: HoldoutBand[] = [];
  for (
    let k = ROOM_PANEL_BAND.minimumPerStayType;
    k <= ROOM_PANEL_BAND.maximumPerStayType;
    k++
  ) {
    const rows = byK.get(k) ?? [];
    const anchors = new Set(rows.map((r) => r.heldOut)).size;
    const placeholder = ROOM_PANEL_BAND_BY_SAMPLE[k];
    if (anchors < MIN_HOLDOUT_PAIRS) {
      unsupported.push(k);
      bands.push({
        sampleSize: k,
        n: anchors,
        observed: { percent: placeholder, source: "editorial-placeholder" },
        scaled: {
          percent: placeholder + SCALED_PLACEHOLDER_POINTS,
          source: "editorial-placeholder",
        },
      });
      continue;
    }
    const percent = Math.max(
      1,
      Math.ceil(weightedPercentile(rows, 0.8) * 100 - 1e-9),
    );
    widths[k] = { percent, heldOutAnchors: anchors, predictions: rows.length };
    bands.push({
      sampleSize: k,
      n: anchors,
      observed: { percent, source: "measured" },
      scaled: { percent, source: "measured" },
    });
  }
  return {
    schemaVersion: 1,
    method: HOLDOUT_METHOD,
    runDate,
    priceLevelsUpdated: priceLevels.updated,
    figureIds: usable.map((f) => f.id),
    pairs,
    widths,
    unsupported,
    bands,
    review: { status: "pending" },
  };
}

export function validateHoldout(h: HoldoutResult): void {
  const ok =
    h?.schemaVersion === 1 &&
    h.method === HOLDOUT_METHOD &&
    isCalendarDate(h.runDate) &&
    h.review?.status === "reviewed" &&
    h.review.reviewer.trim().length > 0 &&
    isCalendarDate(h.review.reviewedAt) &&
    h.review.reviewedAt >= h.runDate &&
    Object.entries(h.widths).every(
      ([k, w]) =>
        roomPanelSampleSize(Number(k), Number(k)) === Number(k) &&
        Number.isSafeInteger(w.percent) &&
        w.percent >= 1 &&
        w.percent < 100 &&
        w.heldOutAnchors >= MIN_HOLDOUT_PAIRS,
    ) &&
    Array.isArray(h.bands) &&
    h.bands.every(
      (b) =>
        Number.isSafeInteger(b.n) &&
        (b.observed.source === "measured") === b.n >= MIN_HOLDOUT_PAIRS &&
        (b.observed.source !== "measured" ||
          h.widths[b.sampleSize]?.percent === b.observed.percent),
    );
  if (!ok) throw Error("Invalid or unreviewed holdout result");
}

/** Measured width and its n for a sample size, when a reviewed run supports it. */
export function measuredWidth(
  h: HoldoutResult | undefined,
  sampleSize: number,
) {
  const w = h?.review.status === "reviewed" ? h.widths[sampleSize] : undefined;
  return w && w.heldOutAnchors >= MIN_HOLDOUT_PAIRS
    ? { percent: w.percent, n: w.heldOutAnchors }
    : undefined;
}

/** One plain line per band: replaced (with n) or still an editorial placeholder. */
export function describeHoldout(h: HoldoutResult): string[] {
  return h.bands.map((b) =>
    b.observed.source === "measured"
      ? `${b.sampleSize} stays per type: REPLACED. Measured ±${b.observed.percent}% (n=${b.n} held-out anchors) for observed and scaled figures; was ±${ROOM_PANEL_BAND_BY_SAMPLE[b.sampleSize]}% and ±${ROOM_PANEL_BAND_BY_SAMPLE[b.sampleSize] + SCALED_PLACEHOLDER_POINTS}%.`
      : `${b.sampleSize} stays per type: NOT REPLACED (n=${b.n}, fewer than ${MIN_HOLDOUT_PAIRS}). Keeps the editorial placeholder: ±${b.observed.percent}% observed, ±${b.scaled.percent}% scaled.`,
  );
}
