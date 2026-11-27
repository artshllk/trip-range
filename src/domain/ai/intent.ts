import { isCurrency, type CurrencyCode } from "../money/currency";
import type {
  StayLevel,
  TripStyle,
  TripRequest,
  TravelLocation,
} from "../types";
export const unsupportedPreferences = [
  "weather",
  "accessibility",
  "pregnancy",
  "nightlife",
  "low-walking",
  "visa-free",
  "direct-flight",
  "pool",
  "other",
] as const;
export type UnsupportedPreference = (typeof unsupportedPreferences)[number];
export type IntentDate = {
  type:
    | "exact"
    | "this-weekend"
    | "next-weekend"
    | "flexible-three-days"
    | "any-weekend";
  start: string | null;
  end: string | null;
  month: string | null;
};
/** Null means unchanged. Destination Anywhere is a separate explicit boolean. No identifiers or prices. */
export type TravelIntent = {
  originQuery: string | null;
  destinationQuery: string | null;
  anywhere: boolean;
  budgetAmount: number | null;
  currency: CurrencyCode | "unsupported" | null;
  adults: number | null;
  children: number | null;
  travellersAmbiguous: boolean;
  travellerTotal: number | null;
  dateIntent: IntentDate | null;
  styles: TripStyle[] | null;
  stayLevel: StayLevel | null;
  nearbyAirports: boolean | null;
  luggage: boolean | null;
  noFlight: boolean | null;
  familyStay: boolean | null;
  unsupportedPreferences: UnsupportedPreference[];
};
export type AiFailure =
  | "configuration"
  | "timeout"
  | "rate-limit"
  | "provider"
  | "malformed"
  | "invalid-input";
export type TravelIntentResult =
  | { status: "available"; intent: TravelIntent }
  | { status: "unavailable"; reason: AiFailure };
export type ClarificationField =
  | "origin"
  | "destination"
  | "budget"
  | "currency"
  | "dates"
  | "party";
export type IntentResolution = {
  status: "ready" | "clarification";
  request: TripRequest;
  unsupportedPreferences: UnsupportedPreference[];
  clarifications: { field: ClarificationField; choices?: TravelLocation[] }[];
};
export const MAX_AI_INPUT = 500;
export const emptyIntent: TravelIntent = {
  originQuery: null,
  destinationQuery: null,
  anywhere: false,
  budgetAmount: null,
  currency: null,
  adults: null,
  children: null,
  travellersAmbiguous: false,
  travellerTotal: null,
  dateIntent: null,
  styles: null,
  stayLevel: null,
  nearbyAirports: null,
  luggage: null,
  noFlight: null,
  familyStay: null,
  unsupportedPreferences: [],
};
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
/** Defense beyond schema enforcement: reject extra keys and out-of-domain output. */
export function readTravelIntent(value: unknown): TravelIntent | undefined {
  if (
    !object(value) ||
    Object.keys(value).length !== Object.keys(emptyIntent).length ||
    Object.keys(value).some((k) => !(k in emptyIntent))
  )
    return;
  if (
    value.currency !== null &&
    value.currency !== "unsupported" &&
    !isCurrency(value.currency)
  )
    return;
  for (const k of ["originQuery", "destinationQuery"] as const)
    if (
      value[k] !== null &&
      (typeof value[k] !== "string" ||
        !/^[\p{L}][\p{L}\p{M} .'-]{1,79}$/u.test(value[k]) ||
        /^[A-Z]{3}$/.test(value[k]))
    )
      return;
  for (const k of [
    "budgetAmount",
    "adults",
    "children",
    "travellerTotal",
  ] as const)
    if (
      value[k] !== null &&
      (typeof value[k] !== "number" ||
        !Number.isFinite(value[k]) ||
        (k !== "budgetAmount" && !Number.isInteger(value[k])))
    )
      return;
  for (const k of ["anywhere", "travellersAmbiguous"] as const)
    if (typeof value[k] !== "boolean") return;
  for (const k of [
    "nearbyAirports",
    "luggage",
    "noFlight",
    "familyStay",
  ] as const)
    if (value[k] !== null && typeof value[k] !== "boolean") return;
  if (
    value.stayLevel !== null &&
    !["simple", "standard", "comfort"].includes(String(value.stayLevel))
  )
    return;
  if (
    value.styles !== null &&
    (!Array.isArray(value.styles) ||
      value.styles.length > 4 ||
      value.styles.some(
        (s) => !["nature", "beach", "city", "quiet"].includes(s),
      ))
  )
    return;
  if (
    !Array.isArray(value.unsupportedPreferences) ||
    value.unsupportedPreferences.length > 9 ||
    value.unsupportedPreferences.some(
      (s) => !unsupportedPreferences.includes(s),
    )
  )
    return;
  const d = value.dateIntent;
  if (d !== null) {
    if (
      !object(d) ||
      Object.keys(d).sort().join() !== "end,month,start,type" ||
      ![
        "exact",
        "this-weekend",
        "next-weekend",
        "flexible-three-days",
        "any-weekend",
      ].includes(String(d.type))
    )
      return;
    for (const k of ["start", "end"] as const)
      if (
        d[k] !== null &&
        (typeof d[k] !== "string" || !/^(?:\d{4}-)?\d{2}-\d{2}$/.test(d[k]))
      )
        return;
    if (
      d.month !== null &&
      (typeof d.month !== "string" || !/^(?:\d{4}-)?\d{2}$/.test(d.month))
    )
      return;
    if (
      ["this-weekend", "next-weekend"].includes(String(d.type)) &&
      (d.start !== null || d.end !== null || d.month !== null)
    )
      return;
  }
  return value as TravelIntent;
}
export function validIntentText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MAX_AI_INPUT &&
    !/[\u0000-\u0008\u000e-\u001f]/.test(value)
  );
}
