/**
 * What is left of a two-adult, two-night budget after the costs we can prove
 * (owner decision, 24 November 2026). Never a trip total.
 *
 *   budget − flights for two − airfare reserve − city tax − airport transfer
 *     = left for room and food
 *   − the traveller's own food amount (theirs, never ours)
 *     → a room figure per night they could spend
 *
 * Every subtracted figure is sourced and dated. A cost without a valid, current
 * record is named as unknown and never treated as zero. A city tax charged as a
 * percentage of the room price cannot be subtracted before the room is known, so the
 * room figure is solved for it instead.
 */
import { money, safetyBufferFor } from "./budget";
import {
  convertObservedAmount,
  evidenceMinorUnits,
  type EvidenceCurrency,
  type FxSnapshot,
} from "./money/fx";

export const PARTY = 2;
export const NIGHTS = 2;
/** Food days the traveller's daily amount is multiplied by, shown to them. */
export const FOOD_DAYS = 2;

export type HotelClass = "1" | "2" | "3" | "4" | "5";
export const hotelClasses: readonly HotelClass[] = ["1", "2", "3", "4", "5"];
export const defaultHotelClass: HotelClass = "3";

export type RecordSource = {
  /** Official publisher: the municipality, tax authority or transport operator. */
  publisher: string;
  title: string;
  url: string;
  /** When we read the source (ISO date). */
  retrievedAt: string;
  /** The rate exactly as the source states it, in the source's language. */
  quote: string;
  language: string;
  /**
   * Set only when the source refuses automated reads after the quote was verified by
   * hand: the source checker then reports it as unverifiable (never as passing) and
   * fails once the manual check is older than 60 days.
   */
  manualCheck?: { checkedOn: string; note: string };
};

type TaxBasis = "per-person-night" | "per-room-night" | "percent-of-room";
/** A city tax value: minor units for fixed bases, a percentage for percent-of-room. */
type TaxValue = number;

export type CityTaxRecord = {
  /** Provider city code as it appears in fares (PAR, MIL, LON...). */
  city: string;
  name: string;
  status: "levied" | "none";
  basis?: TaxBasis;
  currency?: EvidenceCurrency;
  /** One value for every hotel class, or a value per star class. */
  value?: TaxValue;
  byClass?: Partial<Record<HotelClass, TaxValue>>;
  /** Percentage taxes: what the percentage is taken of. */
  percentOf?: "price-including-vat" | "price-excluding-vat";
  /**
   * Accommodation VAT rate (%) when the percentage is taken of the price excluding
   * VAT. Left out when the tax source does not state it: the percentage is then
   * counted on the full price, which slightly overstates the tax (never understates).
   */
  vatPercent?: number;
  /** Percentage taxes: a per-person, per-night ceiling in minor units, if any. */
  capPerPersonNight?: number;
  /** Who and what the rate applies to, as the source states it. */
  scope: string;
  effectiveFrom: string;
  effectiveTo?: string;
  reviewBy: string;
  source: RecordSource;
  /**
   * Further official sources the value depends on when no single source states it
   * as one figure: statutory surcharge rates, the VAT charged on the tax, the act a
   * rate amends. Each is quoted verbatim and checked like `source`.
   */
  supportingSources?: RecordSource[];
  /** How the value follows from the quotes. Required with supportingSources. */
  derivation?: string;
};

export type AirportTransferRecord = {
  /** Arrival airport (IATA) the fare lands at. */
  airport: string;
  city: string;
  /** The route counted, named for the traveller. */
  route: string;
  currency: EvidenceCurrency;
  /** One adult, one way, minor units. */
  oneWayAdult: number;
  effectiveFrom: string;
  reviewBy: string;
  source: RecordSource;
  /** Further sources the route or fare depends on, each quoted and checked. */
  supportingSources?: RecordSource[];
  /** Shown beside the fare, e.g. when it may overstate the lowest fare. */
  note?: string;
};

const iso = /^\d{4}-\d{2}-\d{2}$/;
const iata = /^[A-Z]{3}$/;
const validDate = (s: unknown) =>
  typeof s === "string" && iso.test(s) && Number.isFinite(Date.parse(s));
export const validSource = (s: RecordSource | undefined) =>
  !!s &&
  typeof s.publisher === "string" &&
  s.publisher.trim().length > 1 &&
  typeof s.title === "string" &&
  s.title.trim().length > 1 &&
  typeof s.url === "string" &&
  /^https:\/\/[^\s]+$/.test(s.url) &&
  validDate(s.retrievedAt) &&
  typeof s.quote === "string" &&
  s.quote.trim().length >= 8 &&
  typeof s.language === "string" &&
  /^[a-z]{2}$/.test(s.language) &&
  (s.manualCheck === undefined ||
    (validDate(s.manualCheck.checkedOn) &&
      typeof s.manualCheck.note === "string" &&
      s.manualCheck.note.trim().length > 10));
const minor = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;
const percent = (n: unknown) =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 50;

/** Structural validity. An invalid record is never used; the cost stays unknown. */
export function validCityTax(r: CityTaxRecord): boolean {
  if (
    !r ||
    !iata.test(r.city) ||
    !r.name?.trim() ||
    !r.scope?.trim() ||
    !validDate(r.effectiveFrom) ||
    (r.effectiveTo !== undefined && !validDate(r.effectiveTo)) ||
    !validDate(r.reviewBy) ||
    !validSource(r.source) ||
    (r.effectiveTo !== undefined && r.effectiveTo < r.effectiveFrom)
  )
    return false;
  // Supporting sources and a derivation come together, or not at all.
  if (
    (r.supportingSources !== undefined || r.derivation !== undefined) &&
    !(
      Array.isArray(r.supportingSources) &&
      r.supportingSources.length > 0 &&
      r.supportingSources.every(validSource) &&
      typeof r.derivation === "string" &&
      r.derivation.trim().length >= 20
    )
  )
    return false;
  if (r.status === "none")
    return r.basis === undefined && r.value === undefined && !r.byClass;
  if (r.status !== "levied" || !r.basis || !r.currency) return false;
  if (!Object.prototype.hasOwnProperty.call(evidenceMinorUnits, r.currency))
    return false;
  const values = [
    ...(r.value !== undefined ? [r.value] : []),
    ...Object.values(r.byClass ?? {}),
  ];
  if (!values.length || (r.value !== undefined && r.byClass)) return false;
  if (
    r.byClass &&
    Object.keys(r.byClass).some((k) => !hotelClasses.includes(k as HotelClass))
  )
    return false;
  if (r.basis === "percent-of-room") {
    if (!values.every(percent)) return false;
    if (r.percentOf === "price-excluding-vat")
      return (
        (r.vatPercent === undefined || percent(r.vatPercent)) &&
        (r.capPerPersonNight === undefined || minor(r.capPerPersonNight))
      );
    return (
      r.percentOf === "price-including-vat" &&
      r.vatPercent === undefined &&
      (r.capPerPersonNight === undefined || minor(r.capPerPersonNight))
    );
  }
  return (
    values.every(minor) &&
    r.percentOf === undefined &&
    r.vatPercent === undefined &&
    r.capPerPersonNight === undefined
  );
}

export function validAirportTransfer(r: AirportTransferRecord): boolean {
  return (
    !!r &&
    iata.test(r.airport) &&
    iata.test(r.city) &&
    typeof r.route === "string" &&
    r.route.trim().length > 3 &&
    Object.prototype.hasOwnProperty.call(evidenceMinorUnits, r.currency) &&
    minor(r.oneWayAdult) &&
    r.oneWayAdult > 0 &&
    validDate(r.effectiveFrom) &&
    validDate(r.reviewBy) &&
    validSource(r.source) &&
    (r.supportingSources === undefined ||
      (Array.isArray(r.supportingSources) &&
        r.supportingSources.every(validSource))) &&
    (r.note === undefined ||
      (typeof r.note === "string" && r.note.trim().length > 10))
  );
}

/** A record applies only from its effective date until its review date. */
function current(
  r: { effectiveFrom: string; effectiveTo?: string; reviewBy: string },
  stayDate: string,
  now: number,
) {
  return (
    r.effectiveFrom <= stayDate &&
    (r.effectiveTo === undefined || stayDate <= r.effectiveTo) &&
    now < Date.parse(r.reviewBy + "T00:00:00Z")
  );
}

export type SourceRef = {
  publisher: string;
  url: string;
  effectiveFrom: string;
  /** When we last read the source (ISO date). */
  checkedAt: string;
  /** Set when the source blocks automated checks and was read by hand on this date. */
  manualCheckedOn?: string;
  /** Set when the amount was converted from another currency. */
  fx?: { from: EvidenceCurrency; sourceDate: string };
};
export type KnownCost = {
  id: "flights" | "reserve" | "city-tax" | "airport-transfer";
  cents: number;
  detail: string;
  /** A caveat shown beside the amount. */
  note?: string;
  source?: SourceRef;
  observedAt?: string;
};
export type UnknownCost = {
  id: "city-tax" | "airport-transfer";
  reason: string;
};
export type BudgetLeft = {
  budgetCents: number;
  known: KnownCost[];
  unknown: UnknownCost[];
  /** A sourced "no city tax", shown as known with no amount subtracted. */
  noCityTax?: SourceRef;
  /** A percentage city tax, solved into the room figure rather than subtracted. */
  percentTax?: {
    percent: number;
    percentOf: "price-including-vat" | "price-excluding-vat";
    effectivePercent: number;
    /** Before-VAT tax whose VAT rate the source does not state: counted on the full price. */
    onFullPrice?: true;
    capCentsPerRoomNight?: number;
    source: SourceRef;
  };
  /** No transfer record for this airport: shown as not counted, not as unknown. */
  transferNotCounted?: true;
  /** Budget minus every known subtracted cost. Negative: already over. */
  leftCents: number;
  food?: { perDayCents: number; days: number; cents: number };
  /** Present only when the traveller gave a food amount and something is left. */
  roomPerNightCents?: number;
};

export type BudgetInput = {
  budgetCents: number;
  /** Return fare for two adults, EUR cents. */
  flightPartyCents: number;
  flightObservedAt: string;
  city: string;
  arrivalAirport: string;
  checkIn: string;
  hotelClass: HotelClass;
  foodPerDayCents?: number;
  cityTaxes: readonly CityTaxRecord[];
  transfers: readonly AirportTransferRecord[];
  fx: FxSnapshot | undefined;
  now: number;
};

function toEuroCents(
  amountMinor: number,
  currency: EvidenceCurrency,
  multiplier: number,
  source: RecordSource,
  fx: FxSnapshot | undefined,
  now: number,
): { cents: number; fx?: SourceRef["fx"] } | undefined {
  if (currency === "EUR") return { cents: amountMinor * multiplier };
  const result = convertObservedAmount(
    {
      currencyCode: currency,
      minorAmount: amountMinor,
      minorUnits: evidenceMinorUnits[currency],
      observedAt: source.retrievedAt + "T00:00:00Z",
      source: {
        id: "city-cost-record",
        url: source.url,
        authority: "official-operator",
      },
    },
    "EUR",
    fx,
    now,
    multiplier,
  );
  if (result.status !== "estimate") return undefined;
  return {
    cents: result.amount.cents,
    fx: { from: currency, sourceDate: result.fx.sourceDate },
  };
}

const ref = (
  r: { effectiveFrom: string; source: RecordSource },
  fx?: SourceRef["fx"],
): SourceRef => ({
  publisher: r.source.publisher,
  url: r.source.url,
  effectiveFrom: r.effectiveFrom,
  checkedAt: r.source.retrievedAt,
  ...(r.source.manualCheck
    ? { manualCheckedOn: r.source.manualCheck.checkedOn }
    : {}),
  ...(fx ? { fx } : {}),
});

export function budgetLeft(input: BudgetInput): BudgetLeft {
  const known: KnownCost[] = [
    {
      id: "flights",
      cents: input.flightPartyCents,
      detail: "Return flights for two",
      observedAt: input.flightObservedAt,
    },
    {
      id: "reserve",
      cents: safetyBufferFor(money(input.flightPartyCents, "EUR")).cents,
      detail:
        "Reserve set aside: €20 or 10% of the airfare, whichever is higher",
    },
  ];
  const unknown: UnknownCost[] = [];
  const result: Omit<BudgetLeft, "leftCents"> = {
    budgetCents: input.budgetCents,
    known,
    unknown,
  };

  // City tax: only a valid, current record counts; several current records for one
  // city are ambiguous and stay unknown.
  const taxes = input.cityTaxes.filter(
    (r) =>
      r.city === input.city &&
      validCityTax(r) &&
      current(r, input.checkIn, input.now),
  );
  if (taxes.length !== 1) {
    unknown.push({
      id: "city-tax",
      reason: taxes.length
        ? "conflicting records"
        : "no current official record",
    });
  } else {
    const tax = taxes[0];
    if (tax.status === "none") result.noCityTax = ref(tax);
    else {
      const value = tax.byClass ? tax.byClass[input.hotelClass] : tax.value;
      if (value === undefined)
        unknown.push({
          id: "city-tax",
          reason: `not published for ${input.hotelClass}-star hotels`,
        });
      else if (tax.basis === "percent-of-room") {
        // Of the price before VAT with the VAT rate unstated: count it on the full
        // price, which can only overstate the tax and so understate the room figure.
        const onFullPrice =
          tax.percentOf === "price-excluding-vat" &&
          tax.vatPercent === undefined;
        const effective =
          tax.percentOf === "price-excluding-vat" && !onFullPrice
            ? value / (1 + tax.vatPercent! / 100)
            : value;
        const cap =
          tax.capPerPersonNight === undefined
            ? undefined
            : toEuroCents(
                tax.capPerPersonNight,
                tax.currency!,
                PARTY,
                tax.source,
                input.fx,
                input.now,
              );
        if (tax.capPerPersonNight !== undefined && !cap)
          unknown.push({
            id: "city-tax",
            reason: "no current exchange rate for its cap",
          });
        else
          result.percentTax = {
            percent: value,
            percentOf: tax.percentOf!,
            effectivePercent: effective,
            ...(onFullPrice ? { onFullPrice: true as const } : {}),
            ...(cap ? { capCentsPerRoomNight: cap.cents } : {}),
            source: ref(tax, cap?.fx),
          };
      } else {
        const multiplier =
          tax.basis === "per-person-night" ? PARTY * NIGHTS : NIGHTS;
        const euros = toEuroCents(
          value,
          tax.currency!,
          multiplier,
          tax.source,
          input.fx,
          input.now,
        );
        if (!euros)
          unknown.push({
            id: "city-tax",
            reason: `no current exchange rate for ${tax.currency}`,
          });
        else
          known.push({
            id: "city-tax",
            cents: euros.cents,
            detail:
              tax.basis === "per-person-night"
                ? `City tax for two people, two nights${tax.byClass ? `, ${input.hotelClass}-star hotel` : ""}`
                : `City tax for one room, two nights${tax.byClass ? `, ${input.hotelClass}-star hotel` : ""}`,
            source: ref(tax, euros.fx),
          });
      }
    }
  }

  // Airport transfer at the airport this fare lands at, both ways for two.
  const transfers = input.transfers.filter(
    (r) =>
      r.airport === input.arrivalAirport &&
      r.city === input.city &&
      validAirportTransfer(r) &&
      current(r, input.checkIn, input.now),
  );
  // Owner decision, 24 November 2026: transfer records stop at the airports already
  // sourced. Elsewhere the transfer is shown as not counted, like city travel, not
  // as a missing cost. Conflicting records are a data error and stay unknown.
  if (transfers.length === 0) result.transferNotCounted = true;
  else if (transfers.length > 1)
    unknown.push({ id: "airport-transfer", reason: "conflicting records" });
  else {
    const t = transfers[0];
    const euros = toEuroCents(
      t.oneWayAdult,
      t.currency,
      PARTY * 2,
      t.source,
      input.fx,
      input.now,
    );
    if (!euros)
      unknown.push({
        id: "airport-transfer",
        reason: `no current exchange rate for ${t.currency}`,
      });
    else
      known.push({
        id: "airport-transfer",
        cents: euros.cents,
        detail: `Airport transfer, both ways for two: ${t.route}`,
        ...(t.note ? { note: t.note } : {}),
        source: ref(t, euros.fx),
      });
  }

  const leftCents =
    input.budgetCents - known.reduce((sum, k) => sum + k.cents, 0);
  const out: BudgetLeft = { ...result, leftCents };
  const food = input.foodPerDayCents;
  if (food !== undefined && Number.isSafeInteger(food) && food >= 0) {
    out.food = { perDayCents: food, days: FOOD_DAYS, cents: food * FOOD_DAYS };
    const forRoom = leftCents - out.food.cents;
    // Under a whole euro a night is "nothing left", never "about €0".
    const room = forRoom > 0 ? roomPerNight(forRoom, out.percentTax) : 0;
    if (room > 0) out.roomPerNightCents = room;
  }
  return out;
}

/** Solve n·R + tax(R) = money for the nightly room price R; rounded down to whole euros. */
export function roomPerNight(
  forRoomCents: number,
  tax?: BudgetLeft["percentTax"],
): number {
  const perNight = forRoomCents / NIGHTS;
  let room = perNight;
  if (tax) {
    room = perNight / (1 + tax.effectivePercent / 100);
    if (
      tax.capCentsPerRoomNight !== undefined &&
      (room * tax.effectivePercent) / 100 > tax.capCentsPerRoomNight
    )
      room = perNight - tax.capCentsPerRoomNight;
  }
  return Math.max(0, Math.floor(room / 100) * 100);
}
