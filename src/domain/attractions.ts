/**
 * Official sight prices for a destination card (owner decision, 25 November 2026).
 * Each record is sourced, quoted and dated in content/city-costs/attractions.json
 * and checked by scripts/check-city-cost-sources.mjs. A sight is listed only with
 * an official basis (visitor figures), never preference. Prices are shown as
 * optional: they are not subtracted from the budget. Closures and free days that
 * fall inside the stay follow the official opening data.
 */
import { PARTY, validSource, type RecordSource } from "./budget-left";

export type AttractionRecord = {
  city: string;
  id: string;
  name: string;
  /** Why this sight is listed: an official fact, quoted. */
  selection: { fact: string; source: RecordSource };
  ticket: {
    name: string;
    currency: "EUR";
    /** One adult, minor units. */
    adult: number;
    effectiveFrom: string;
    reviewBy: string;
    source: RecordSource;
    supportingSources?: RecordSource[];
    /** A part of the price the official source does not state. */
    unknown?: string;
  };
  opening: {
    validFrom: string;
    validTo?: string;
    lastEntry: string;
    closes: string;
    closedOn: string[];
    freeFirstSunday: boolean;
    source: RecordSource;
    supportingSources?: RecordSource[];
  };
};

const iso = /^\d{4}-\d{2}-\d{2}$/;
const time = /^\d{2}:\d{2}$/;
export function validAttraction(r: AttractionRecord): boolean {
  return (
    !!r &&
    /^[A-Z]{3}$/.test(r.city) &&
    !!r.id &&
    !!r.name?.trim() &&
    validSource(r.selection?.source) &&
    r.ticket?.currency === "EUR" &&
    Number.isSafeInteger(r.ticket.adult) &&
    r.ticket.adult >= 0 &&
    iso.test(r.ticket.effectiveFrom) &&
    iso.test(r.ticket.reviewBy) &&
    validSource(r.ticket.source) &&
    (r.ticket.supportingSources ?? []).every(validSource) &&
    iso.test(r.opening?.validFrom) &&
    (r.opening.validTo === undefined || iso.test(r.opening.validTo)) &&
    time.test(r.opening.lastEntry) &&
    time.test(r.opening.closes) &&
    r.opening.closedOn.every((d) => iso.test(d)) &&
    validSource(r.opening.source) &&
    (r.opening.supportingSources ?? []).every(validSource)
  );
}

type Cite = {
  publisher: string;
  url: string;
  quote: string;
  checkedAt: string;
};
const cite = (s: RecordSource): Cite => ({
  publisher: s.publisher,
  url: s.url,
  quote: s.quote,
  checkedAt: s.retrievedAt,
});

/** Plain data for the card: safe to pass to a client component. */
export type StayAttraction = {
  id: string;
  name: string;
  basis: string;
  basisSource: Cite;
  ticketName: string;
  status: "priced" | "unknown";
  adultCents?: number;
  /** For two people, when priced. */
  partyCents?: number;
  priceSource: Cite;
  unknownPart?: string;
  lastEntry?: string;
  hoursSource: Cite;
  /** Dates of the stay when the sight is closed. */
  closedOn: string[];
  /** Dates of the stay when entry is free (first Sunday). */
  freeOn: string[];
};

const days = (checkIn: string, checkOut: string) => {
  const out: string[] = [];
  for (
    let t = Date.parse(checkIn + "T00:00:00Z");
    t <= Date.parse(checkOut + "T00:00:00Z");
    t += 86_400_000
  )
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};
const firstSunday = (d: string) => {
  const x = new Date(d + "T00:00:00Z");
  return x.getUTCDay() === 0 && x.getUTCDate() <= 7;
};

export function attractionsForStay(input: {
  records: readonly AttractionRecord[];
  city: string;
  checkIn: string;
  checkOut: string;
  now: number;
}): StayAttraction[] {
  const stay = days(input.checkIn, input.checkOut);
  return input.records
    .filter((r) => r.city === input.city && validAttraction(r))
    .map((r) => {
      const current =
        r.ticket.effectiveFrom <= input.checkIn &&
        input.now < Date.parse(r.ticket.reviewBy + "T00:00:00Z");
      const hoursKnown =
        r.opening.validFrom <= input.checkIn &&
        (r.opening.validTo === undefined ||
          input.checkOut <= r.opening.validTo);
      return {
        id: r.id,
        name: r.name,
        basis: r.selection.fact,
        basisSource: cite(r.selection.source),
        ticketName: r.ticket.name,
        status: current ? "priced" : "unknown",
        ...(current
          ? { adultCents: r.ticket.adult, partyCents: r.ticket.adult * PARTY }
          : {}),
        priceSource: cite(r.ticket.source),
        ...(r.ticket.unknown ? { unknownPart: r.ticket.unknown } : {}),
        ...(hoursKnown ? { lastEntry: r.opening.lastEntry } : {}),
        hoursSource: cite(r.opening.source),
        closedOn: stay.filter((d) => r.opening.closedOn.includes(d)),
        freeOn: r.opening.freeFirstSunday ? stay.filter(firstSunday) : [],
      };
    });
}
