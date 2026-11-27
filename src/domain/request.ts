import {
  isCurrency,
  parsePlanningBudget,
  majorUnits,
  type CurrencyCode,
} from "./money/currency";
import { readMoneyIntent } from "./money/intent";
import { planningCurrency } from "./market/policy";
import { primaryOriginId } from "./market/primary-origin";
import { decodeLocation } from "./locations";
import {
  addDays,
  weekendsInMonth,
  isCalendarDate,
  nightsBetween,
  resolveTravelDates,
  type CalendarDate,
} from "./dates";
import type { TripRequest, TripStyle, TravelLocation } from "./types";
import { money } from "./budget";
import { locations, findLocation } from "../catalogue/locations";
export const styles: TripStyle[] = ["nature", "beach", "city", "quiet"];
export const defaultRequest: TripRequest = {
  budget: money(50000),
  party: { adults: 2, children: 0 },
  // Explicit product prefill. Search originResolution still rejects missing or
  // invalid origin input; a default never silently authorizes a search.
  originId: primaryOriginId,
  scope: "anywhere",
  when: "weekend",
  dates: resolveTravelDates("weekend", "2026-10-06"),
  nights: 2,
  flexible: false,
  styles: [],
  preferences: {
    nearbyAirports: false,
    car: false,
    luggage: false,
    familyStay: false,
    stayLevel: "standard",
  },
};
export type Query = Record<string, string | string[] | undefined>;
function one(q: Query, key: string) {
  const v = q[key];
  return typeof v === "string" ? v : undefined;
}
function number(
  q: Query,
  key: string,
  fallback: number,
  min: number,
  max: number,
) {
  const raw = one(q, key);
  const n = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : fallback;
}
export function parseBudget(raw?: string, currency: CurrencyCode = "EUR") {
  return parsePlanningBudget(raw, currency) ?? money(50000, currency);
}
export function parseRequest(
  q: Query,
  catalogue: readonly TravelLocation[] = locations,
  today: CalendarDate = "2026-10-06",
): TripRequest {
  const selectedOrigin = decodeLocation(one(q, "originPlace"));
  const destination = decodeLocation(one(q, "toPlace"));
  const originId =
    selectedOrigin?.id ??
    findLocation(one(q, "origin") ?? one(q, "from"), catalogue)?.id ??
    defaultRequest.originId;
  const when =
    (["weekend", "next-weekend", "month", "summer", "custom"] as const).find(
      (w) => w === one(q, "when"),
    ) ?? "weekend";
  const level =
    (["simple", "standard", "comfort"] as const).find(
      (l) => l === one(q, "stay"),
    ) ?? "standard";
  const start = one(q, "start");
  const end = one(q, "end");
  const explicit =
    isCalendarDate(start) &&
    isCalendarDate(end) &&
    nightsBetween(start, end) >= 1 &&
    nightsBetween(start, end) <= 14;
  const nights = explicit
    ? nightsBetween(start!, end!)
    : number(q, "nights", 2, 1, 14);
  const flexibleDays =
    one(q, "flexDays") === "3" ||
    (!one(q, "flexDays") && one(q, "flex") === "1")
      ? 3
      : 0;
  const dates = explicit
    ? { startDate: start!, endDate: end!, flexibleDays }
    : resolveTravelDates(
        when === "custom" ? "weekend" : when,
        today,
        nights,
        flexibleDays,
      );
  if (one(q, "dateMode") === "weekends") {
    const month = one(q, "month") ?? today.slice(0, 7);
    const weekends = weekendsInMonth(month, today);
    if (weekends.length)
      Object.assign(dates, { ...weekends[0], mode: "weekends", month });
  }
  return {
    ...(/^place:Q[1-9]\d{0,11}$/.test(one(q, "arrivalFor") ?? "") &&
    /^[A-Z]{3}$/.test(one(q, "arrival") ?? "")
      ? {
          arrivalEntry: {
            destinationId: one(q, "arrivalFor")!,
            code: one(q, "arrival")!,
          },
        }
      : {}),
    ...(/^[A-Z]{3}$/.test(one(q, "departure") ?? "")
      ? { departureAirport: one(q, "departure") }
      : {}),
    ...(selectedOrigin ? { origin: selectedOrigin } : {}),
    ...(destination ? { destination } : {}),
    ...(one(q, "noFlight") === "1" ? { noFlight: true } : {}),
    budget: parseBudget(
      one(q, "budget"),
      isCurrency(one(q, "currency"))
        ? (one(q, "currency") as CurrencyCode)
        : planningCurrency(selectedOrigin ?? findLocation(originId, catalogue))
            .currency,
    ),
    party: {
      adults: number(q, "adults", 2, 1, 8),
      children: number(q, "children", 0, 0, 6),
    },
    originId,
    scope:
      one(q, "scope") === "domestic" ||
      (!one(q, "scope") &&
        (one(q, "styles") ?? "").split(",").includes("kosovo"))
        ? "domestic"
        : "anywhere",
    when: explicit && !one(q, "when") ? "custom" : when,
    dates,
    nights: nightsBetween(dates.startDate, dates.endDate),
    flexible: dates.flexibleDays > 0,
    styles: styles.filter((s) =>
      (one(q, "styles") ?? "").split(",").includes(s),
    ),
    preferences: {
      nearbyAirports: one(q, "airports") === "1",
      car: one(q, "car") === "1",
      luggage: one(q, "luggage") === "1",
      familyStay: one(q, "family") === "1",
      stayLevel: level,
    },
  };
}
export type OriginResolution =
  | "selected"
  | "catalogue"
  | "missing"
  | "unresolved";
/** Whether the query names an origin we can identify. parseRequest still falls back
 * to the default origin (a form's prefill); a search must check this first and never
 * run from that fallback. A corrupt place is unresolved even beside a valid id. */
export function originResolution(
  q: Query,
  catalogue: readonly TravelLocation[] = locations,
): OriginResolution {
  const place = q.originPlace;
  const named = q.origin ?? q.from;
  if (place !== undefined)
    return typeof place === "string" && decodeLocation(place)
      ? "selected"
      : "unresolved";
  if (named === undefined || named === "") return "missing";
  return typeof named === "string" && findLocation(named, catalogue)
    ? "catalogue"
    : "unresolved";
}
export function requestQuery(r: TripRequest): string {
  return new URLSearchParams({
    ...(r.arrivalEntry
      ? {
          arrivalFor: r.arrivalEntry.destinationId,
          arrival: r.arrivalEntry.code,
        }
      : {}),
    ...(r.departureAirport ? { departure: r.departureAirport } : {}),
    ...(r.origin ? { originPlace: JSON.stringify(r.origin) } : {}),
    ...(r.destination ? { toPlace: JSON.stringify(r.destination) } : {}),
    ...(r.noFlight ? { noFlight: "1" } : {}),
    ...(r.dates.mode === "weekends"
      ? { dateMode: "weekends", month: r.dates.month! }
      : {}),
    budget: majorUnits(r.budget),
    currency: r.budget.currency,
    adults: String(r.party.adults),
    children: String(r.party.children),
    origin: r.originId,
    scope: r.scope,
    when: r.when,
    start: r.dates.startDate,
    end: r.dates.endDate,
    flexDays: String(r.dates.flexibleDays),
    nights: String(r.nights),
    flex: r.flexible ? "1" : "0",
    styles: r.styles.join(","),
    airports: r.preferences.nearbyAirports ? "1" : "0",
    car: r.preferences.car ? "1" : "0",
    luggage: r.preferences.luggage ? "1" : "0",
    family: r.preferences.familyStay ? "1" : "0",
    stay: r.preferences.stayLevel,
  }).toString();
}
/** Intentionally small demo parser: unsupported words never pretend to be understood. */
export function parseDemoSentence(
  text: string,
  base: TripRequest,
  today: CalendarDate = "2026-10-06",
): TripRequest {
  const budget = readMoneyIntent(text);
  const people = text.match(/(\d+)\s*(?:people|persons?|persona|veta)/i);
  const origin = locations.find((o) =>
    text.toLowerCase().includes(o.name.toLowerCase()),
  );
  return parseRequest(
    {
      ...Object.fromEntries(new URLSearchParams(requestQuery(base))),
      ...(origin && origin.id !== base.originId
        ? { currency: planningCurrency(origin).currency }
        : {}),
      ...(budget.status === "explicit"
        ? {
            budget: majorUnits(budget.amount),
            currency: budget.amount.currency,
          }
        : {}),
      ...(people ? { adults: people[1], children: "0" } : {}),
      ...(origin ? { origin: origin.id, originPlace: undefined } : {}),
      ...(/next month|muajin tjetër/i.test(text)
        ? { when: "month", start: undefined, end: undefined }
        : {}),
    },
    locations,
    today,
  );
}

/** Keep all duplicate UI intent fields consistent when editing dates or trip length. */
export function updateRequestDates(
  request: TripRequest,
  patch: Partial<TripRequest>,
  today: CalendarDate,
): TripRequest {
  const next = { ...request, ...patch };
  if (patch.when && patch.when !== "custom")
    next.dates = resolveTravelDates(
      patch.when,
      today,
      next.nights,
      next.flexible ? 3 : 0,
    );
  else
    next.dates = {
      ...next.dates,
      endDate: addDays(next.dates.startDate, next.nights),
      flexibleDays: next.flexible ? 3 : 0,
    };
  return next;
}
export function defaultRequestFor(today: CalendarDate): TripRequest {
  return { ...defaultRequest, dates: resolveTravelDates("weekend", today) };
}
/** An origin edit keeps the entered major-unit amount; it is not an FX conversion. */
export function requestWithOrigin(
  request: TripRequest,
  origin: TravelLocation,
): TripRequest {
  return {
    ...request,
    origin,
    originId: origin.id,
    departureAirport: undefined,
    budget:
      origin.id === request.originId
        ? request.budget
        : parseBudget(
            majorUnits(request.budget),
            planningCurrency(origin).currency,
          ),
  };
}
