// Reviewed planning inputs only. The app never loads a research worksheet.
import { addDays, isCalendarDate } from "./dates";
import { isCurrency, money, type MoneyAmount } from "./money/currency";
import type { Destination, TripRequest } from "./types";
import { roomPanelBandPercent } from "./costs/room-panel";

export type PanelEvidence = {
  method: "room-panel-v8-displayed-rate";
  destinationId: string;
  countryCode: string;
  sourceId: string;
  checkedDate: string;
  reviewAfter: string;
  weekday: number;
  weekend: number;
  included: number;
  extra: number;
  silent: number;
  // City-panel override only when the reviewed evidence agrees on the amount
  // across every contributor. One hotel cannot establish a citywide extra.
  statedExtra?: {
    scope: "uniform-across-contributors";
    amount: MoneyAmount;
    stayCents: number;
    adults: number;
    children: number;
    startDate: string;
    endDate: string;
    sourceUrl: string;
  };
  /**
   * Set when the room figure is scaled from another city's panel. Owner position
   * (3 Nov): a scaled stay carries the anchor's embedded tax treatment, not the
   * destination's own; no destination tax is estimated or added.
   */
  scaledFrom?: { anchorId: string };
  /**
   * The figure's planning band: measured by the holdout once reviewed, otherwise the
   * provisional sample-size rule (+ the scaled placeholder). Absent: the rule.
   */
  bandPercent?: number;
};
export type PanelTax = {
  treatment: "included" | "extra" | "possible" | "no-levy" | "inherited";
  amount?: MoneyAmount;
  source: string;
  panelSourceId: string;
  rulesChecked: "2026-11-03";
  operatorAmount?: true;
  atHotel: boolean;
  weekday: number;
  weekend: number;
  bandPercent: number;
  upperAllowance?: MoneyAmount;
};
const wien = "https://www.wien.gv.at/amtswege/ortstaxe";
const milano =
  "https://servizicrm.comune.milano.it/centro-supporto/KA-02206/Imposta-di-soggiorno-tariffe-per-strutture";
const barcelona = "https://atc.gencat.cat/ca/tributs/ieet/quota-tributaria";
const london = "https://www.london.gov.uk/overnight-visitor-levy-london";
const istanbul = "https://corum.gib.gov.tr/mevzuat/kanun/445";
const cities = [
  ["AT", ["vienna", "city:VIE", "place:Q1741"], wien],
  ["IT", ["milan", "city:MIL", "place:Q490"], milano],
  ["ES", ["barcelona", "city:BCN", "place:Q1492"], barcelona],
  ["GB", ["london", "city:LON", "place:Q84"], london],
  ["TR", ["istanbul", "city:IST", "place:Q406"], istanbul],
] as const;

// Undefined means insufficient, stale or misbound evidence, never zero tax.
// The estimates below are for the standard three-star panel, ordinary tourism.
// No foreign amount is converted. Per-night tariffs are confined to their sourced periods.
export function resolvePanelTax(
  p: PanelEvidence,
  d: Destination,
  r: TripRequest,
  stay: MoneyAmount,
  today: string,
): PanelTax | undefined {
  const scaled = p.scaledFrom;
  const city = scaled
    ? undefined
    : cities.find(
        ([country, ids]) =>
          country === d.countryCode && ids.some((id) => id === d.id),
      );
  const rule = roomPanelBandPercent(p.weekday, p.weekend);
  const band = p.bandPercent ?? rule;
  if (
    (!city && !scaled) ||
    rule === undefined || // fewer than four of either stay type
    band === undefined ||
    !Number.isSafeInteger(band) ||
    band < 1 ||
    band >= 100 ||
    d.id !== p.destinationId ||
    d.countryCode !== p.countryCode ||
    p.method !== "room-panel-v8-displayed-rate" ||
    !p.sourceId?.trim() ||
    !isCalendarDate(r.dates.startDate) ||
    !isCalendarDate(r.dates.endDate) ||
    addDays(r.dates.startDate, r.nights) !== r.dates.endDate ||
    !isCalendarDate(today) ||
    !isCalendarDate(p.checkedDate) ||
    !isCalendarDate(p.reviewAfter) ||
    p.checkedDate > today ||
    p.reviewAfter < today ||
    r.preferences.stayLevel !== "standard" ||
    ![p.weekday, p.weekend, p.included, p.extra, p.silent].every(
      (v) => Number.isSafeInteger(v) && v >= 0,
    ) ||
    Math.max(p.weekday, p.weekend) > (city?.[0] === "GB" ? 6 : 8) ||
    p.included + p.extra + p.silent !== p.weekday + p.weekend
  )
    return;
  if (scaled)
    return scaled.anchorId === p.sourceId
      ? {
          treatment: "inherited",
          panelSourceId: p.sourceId,
          rulesChecked: "2026-11-03",
          weekday: p.weekday,
          weekend: p.weekend,
          bandPercent: band,
          source: "",
          atHotel: false,
        }
      : undefined;
  if (!city) return;
  const [country, , source] = city;
  const n = p.weekday + p.weekend;
  const common = {
    panelSourceId: p.sourceId,
    rulesChecked: "2026-11-03" as const,
    weekday: p.weekday,
    weekend: p.weekend,
    bandPercent: band,
    source,
    atHotel: country !== "TR",
  };
  if (p.included === n) return { ...common, treatment: "included" };
  if (
    country === "GB" &&
    r.dates.startDate >= "2026-11-03" &&
    r.dates.endDate <= "2027-01-01"
  ) {
    // A property-specific fee cannot become a statutory London levy.
    if (p.extra) return;
    return { ...common, treatment: "no-levy" };
  }
  const treatment = p.extra === n ? "extra" : "possible";
  const stated = p.statedExtra;
  if (
    treatment === "extra" &&
    stated?.scope === "uniform-across-contributors" &&
    stated.stayCents === stay.cents &&
    stated.adults === r.party.adults &&
    stated.children === r.party.children &&
    stated.startDate === r.dates.startDate &&
    stated.endDate === r.dates.endDate &&
    /^https:\/\//.test(stated.sourceUrl) &&
    isCurrency(stated.amount.currency) &&
    stated.amount.currency === stay.currency &&
    Number.isSafeInteger(stated.amount.cents) &&
    stated.amount.cents > 0
  )
    return {
      ...common,
      source: stated.sourceUrl,
      operatorAmount: true as const,
      treatment,
      amount: stated.amount,
    };
  const from = r.dates.startDate,
    last = addDays(r.dates.endDate, -1);
  let cents: number | undefined, upper: number | undefined;
  if (country === "AT" && from >= "2026-07-01" && last <= "2027-06-30") {
    // Possible EXTRA scenario: ordinary hotel VAT 10%, room only. The city's
    // 4.3478% key instead extracts a tax ALREADY inside an all-in gross total.
    // Estimate once, round upward to a whole unit for a possible-tax disclosure;
    // Unknown VAT status can imply a larger extra: net lodging cannot exceed
    // the entire displayed price. Use that inequality ONLY for the fit ceiling.
    cents =
      treatment === "extra"
        ? Math.round(stay.cents / 22)
        : Math.ceil(stay.cents / 2200) * 100;
    upper = Math.max(cents, Math.ceil(stay.cents / 20));
  } else if (country === "TR" && from >= "2026-05-01" && last <= "2026-12-31") {
    // Supplier is liable. Possible pass-through limit, not a payment due at reception.
    upper = Math.ceil(stay.cents / 100);
    cents = upper;
  } else if (
    stay.currency === "EUR" &&
    from >= "2026-04-01" &&
    ((country === "IT" && last <= "2026-12-31") ||
      (country === "ES" && last <= "2027-03-31"))
  ) {
    // Milan €7; Barcelona IEET €2 + €5 municipal surcharge, plus 10% hotel VAT; max seven nights.
    // Child ages unknown: do not quote a tax for a family from adult-only input.
    if (!r.party.children)
      cents =
        r.party.adults *
        (country === "ES" ? Math.min(7, r.nights) : r.nights) *
        (country === "ES" ? 770 : 700);
  }
  if (cents === undefined || cents <= 0) return { ...common, treatment };
  return {
    ...common,
    treatment,
    amount: money(cents, stay.currency),
    upperAllowance: money(
      (upper ?? cents) - (treatment === "extra" ? cents : 0),
      stay.currency,
    ),
  };
}
