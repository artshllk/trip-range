import { sameSpanishMunicipality } from "./spain-municipalities";
import { isCalendarDate } from "./dates";
import { roomPanelBandPercent, type RoomPanelFigure } from "./costs/room-panel";
import type { StayData } from "./costs/stay-figures";

export type RoomSource = {
  title: string;
  url: string;
  attribution: string;
  reuse: string;
  reuseUrl: string;
  sha256: string;
};
export type PublishedRoom = {
  kind: "published";
  cityCode: string;
  municipalityName?: string;
  pooledRoomNightCents?: number;
  priceNote?: string;
  countryCode: string;
  roomNightCents: number;
  currency: "EUR";
  scope: "pooled" | "three-star";
  period: { start: string; end: string; label: string };
  checkedAt: string;
  reviewAfter: string;
  frequency: "annual" | "monthly";
  source: RoomSource;
  caveat: string;
};
export type MeasuredRoom = {
  kind: "measured";
  figure: RoomPanelFigure;
};
export type RoomEvidence =
  | PublishedRoom
  | MeasuredRoom
  | { kind: "unavailable" };

/** Same-city, reviewed evidence only. Never import a neighbouring city's allowance. */
export function roomEvidence(
  cityCode: string,
  countryCode: string,
  today: string,
  published: readonly PublishedRoom[],
  panels: StayData,
  municipalityName?: string,
): RoomEvidence {
  if (!isCalendarDate(today)) return { kind: "unavailable" };
  const figure = panels.figures
    .filter(
      (f) =>
        f.destinationId === `city:${cityCode}` &&
        f.countryCode === countryCode &&
        f.review.status === "reviewed" &&
        f.review.reviewedAt <= today &&
        f.observationDate <= today &&
        today <= f.reviewAfter &&
        roomPanelBandPercent(f.weekday.contributing, f.weekend.contributing) !==
          undefined,
    )
    .sort((a, b) => b.observationDate.localeCompare(a.observationDate))[0];
  if (figure) return { kind: "measured", figure };
  const candidates = published
    .filter(
      (f) =>
        (f.cityCode === cityCode ||
          (countryCode === "ES" &&
            !!municipalityName &&
            !!f.municipalityName &&
            sameSpanishMunicipality(f.municipalityName, municipalityName))) &&
        f.countryCode === countryCode &&
        f.checkedAt <= today &&
        today <= f.reviewAfter &&
        f.period.end <= today,
    )
    .sort(
      (a, b) =>
        b.period.end.localeCompare(a.period.end) ||
        Number(b.scope === "three-star") - Number(a.scope === "three-star"),
    );
  // Two independently identified municipalities with the same normalized name
  // are ambiguous. Never let source order decide which city's price to show.
  if (
    new Set(candidates.filter((f) => f.municipalityName).map((f) => f.cityCode))
      .size > 1
  )
    return { kind: "unavailable" };
  return candidates[0] ?? { kind: "unavailable" };
}

export function validatePublishedRooms(
  figures: readonly PublishedRoom[],
): void {
  const keys = new Set<string>();
  for (const f of figures) {
    const key = `${f.cityCode}:${f.period.start}:${f.scope}`;
    if (
      keys.has(key) ||
      f.kind !== "published" ||
      !(
        /^[A-Z]{3}$/.test(f.cityCode) ||
        (f.countryCode === "ES" &&
          /^ine:EOT\d+$/.test(f.cityCode) &&
          !!f.municipalityName)
      ) ||
      !/^[A-Z]{2}$/.test(f.countryCode) ||
      f.currency !== "EUR" ||
      !["pooled", "three-star"].includes(f.scope) ||
      !["annual", "monthly"].includes(f.frequency) ||
      !Number.isSafeInteger(f.roomNightCents) ||
      f.roomNightCents <= 0 ||
      f.roomNightCents > 1000000 ||
      (f.pooledRoomNightCents !== undefined &&
        (f.scope !== "three-star" ||
          !Number.isSafeInteger(f.pooledRoomNightCents) ||
          f.pooledRoomNightCents <= 0 ||
          f.pooledRoomNightCents > 1000000)) ||
      ![f.period.start, f.period.end, f.checkedAt, f.reviewAfter].every(
        isCalendarDate,
      ) ||
      f.period.start > f.period.end ||
      f.period.end > f.checkedAt ||
      f.period.end >= f.reviewAfter ||
      (f.checkedAt >= f.reviewAfter && f.frequency !== "monthly") ||
      !f.period.label ||
      !f.caveat ||
      !f.source.title ||
      !f.source.attribution ||
      !f.source.reuse ||
      !/^[a-f0-9]{64}$/.test(f.source.sha256) ||
      ![f.source.url, f.source.reuseUrl].every((u) => {
        try {
          return new URL(u).protocol === "https:";
        } catch {
          return false;
        }
      })
    )
      throw Error(`Invalid published room evidence: ${key}`);
    keys.add(key);
  }
}

export type TripCostInput = {
  flightCents?: number;
  flightCurrency?: "EUR" | "USD" | "GBP" | "CHF";
  children?: number;
  budgetCents: number;
  checkIn: string;
  checkOut: string;
  adults: number;
  rooms: number;
  /** Reviewed whole-party costs for these dates, including mandatory charges.
   * Undefined is unknown; zero must be supported evidence, never a default. */
  otherCosts?: {
    foodCents: number;
    transportCents: number;
    chargesCents: number;
    reserveCents: number;
  };
};
export type TripCostVerdict = {
  text: string;
  low?: number;
  high?: number;
  basis: "incomplete" | "measured" | "published-class";
};
export const roomEuros = (cents: number) =>
  new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(cents / 100);

/** A quote spread is only a spread of checked rooms, never a prediction interval. */
export function tripCostVerdict(
  room: RoomEvidence,
  input: TripCostInput,
): TripCostVerdict {
  const incomplete = (text: string): TripCostVerdict => ({
    basis: "incomplete",
    text,
  });
  if (room.kind === "published" && room.scope === "pooled")
    return incomplete(
      "Hotel market context only. Your trip total is not yet known; check room prices for your dates before deciding whether it fits.",
    );
  if (room.kind === "unavailable")
    return incomplete(
      "Trip total not yet known. Check room prices for your dates, then allow for food, transport and any extra charges.",
    );
  const other = input.otherCosts;
  if (
    !other ||
    input.flightCents === undefined ||
    ![input.flightCents, input.budgetCents, ...Object.values(other)].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    )
  )
    return incomplete(
      "Trip total not yet known. Room evidence is shown, but flights, food, transport or mandatory charges still need checking.",
    );
  if (
    input.adults !== 2 ||
    input.rooms !== 1 ||
    (input.children ?? 0) !== 0 ||
    (input.flightCurrency ?? "EUR") !== "EUR"
  )
    return incomplete(
      "This room evidence covers two adults sharing one room. Check prices for your party before comparing the whole trip with your budget.",
    );
  const base =
    input.flightCents + Object.values(other).reduce((a, b) => a + b, 0);
  if (room.kind === "measured") {
    const stay = (["weekday", "weekend"] as const).find(
      (s) =>
        room.figure[s].checkIn === input.checkIn &&
        room.figure[s].checkOut === input.checkOut,
    );
    if (!stay)
      return incomplete(
        "Measured room baseline for the dates shown, not a quote for your stay. Check your dates before judging budget fit.",
      );
    const quotes = room.figure.contributors
      .filter((c) => c.stayType === stay)
      .map((c) => c.twoNightCents);
    if (quotes.length < 4)
      return incomplete(
        "Too few checked rooms for these dates to assess a budget.",
      );
    const low = base + Math.min(...quotes),
      high = base + Math.max(...quotes);
    const budget = input.budgetCents;
    const text =
      high <= budget
        ? `Across the rooms checked, this trip leaves ${roomEuros(budget - high)}–${roomEuros(budget - low)} within your budget, including the listed costs and reserve. Prices may change before booking.`
        : low > budget
          ? `Every contributing room puts this trip over your budget by ${roomEuros(low - budget)}–${roomEuros(high - budget)}, including the listed costs and reserve. Prices may change.`
          : `Some checked rooms fit and others exceed your budget: ${roomEuros(low)}–${roomEuros(high)} including the listed costs and reserve. Prices may change.`;
    return { basis: "measured", low, high, text };
  }
  const nights =
    (Date.parse(input.checkOut) - Date.parse(input.checkIn)) / 86400000;
  if (!Number.isInteger(nights) || nights < 1)
    return incomplete("Choose valid stay dates to assess costs.");
  const total = base + room.roomNightCents * nights,
    margin = input.budgetCents - total;
  return {
    basis: "published-class",
    low: total,
    high: total,
    text: `Using the published three-star average, this trip is roughly ${roomEuros(Math.abs(margin))} ${margin >= 0 ? "under" : "over"} your budget, including the listed costs and reserve. Individual rooms vary; check prices for your dates.`,
  };
}
