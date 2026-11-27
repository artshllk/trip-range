import { isCalendarDate } from "../dates";
import { object, keys } from "../places/validation";
import {
  currencyMetadata,
  isCurrency,
  money,
  type MoneyAmount,
} from "./currency";

// Evidence currencies are deliberately separate from selectable planning currencies.
export const evidenceMinorUnits = {
  EUR: 2,
  GBP: 2,
  USD: 2,
  CHF: 2,
  JPY: 0,
  DKK: 2,
  TRY: 2,
  // City tax and airport transfer records (owner decision, 24 November 2026).
  CZK: 2,
  HUF: 2,
  SEK: 2,
  PLN: 2,
} as const;
export type EvidenceCurrency = keyof typeof evidenceMinorUnits;
export type ObservedForeignAmount = {
  currencyCode: EvidenceCurrency;
  minorAmount: number;
  minorUnits: number;
  observedAt: string;
  source: { id: string; url: string; authority: "official-operator" };
};
export type FxSnapshot = {
  id: string;
  source: "ecb";
  sourceUrl: string;
  sourceDate: string;
  checkedAt: string;
  reviewAfter: string;
  reviewStatus: "draft" | "reviewed";
  baseCurrency: "EUR";
  rates: { currency: EvidenceCurrency; perEuro: string }[];
};
export type FxData = { schemaVersion: 1; records: FxSnapshot[] };
const day = 86400000;
/** Outer snapshot ceiling. Each conversion also enforces both currency windows. */
export const FX_VALID_DAYS = 30;
export const FX_WINDOW_POLICY = "ecb-currency-windows-v1";
/** Application freshness limits, not ECB guarantees. TRY allows a normal weekend;
 * longer gaps fail closed. DKK retains the existing window under its euro peg. */
export const fxValidityDays = {
  EUR: 30,
  GBP: 30,
  USD: 30,
  CHF: 30,
  JPY: 30,
  DKK: 30,
  TRY: 4,
  CZK: 30,
  HUF: 30,
  SEK: 30,
  PLN: 30,
} as const satisfies Record<EvidenceCurrency, number>;

export function fxCurrencyReviewAfter(
  snapshot: FxSnapshot,
  currency: EvidenceCurrency,
): number {
  return Math.min(
    Date.parse(snapshot.reviewAfter),
    Date.parse(`${snapshot.sourceDate}T00:00:00Z`) +
      fxValidityDays[currency] * day,
  );
}

export type FxConversionProvenance = {
  id: string;
  source: "ecb";
  sourceUrl: string;
  sourceDate: string;
  checkedAt: string;
  snapshotReviewAfter: string;
  convertedAt: string;
  conversionDate: string;
  ageMilliseconds: number;
  baseCurrency: "EUR";
  from: { currency: EvidenceCurrency; perEuro: string; validityDays: number };
  to: { currency: EvidenceCurrency; perEuro: string; validityDays: number };
  windowPolicy: typeof FX_WINDOW_POLICY;
  appliedWindowDays: number;
  validUntil: string;
};
export function evidenceInstant(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v) &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString().replace(".000Z", "Z") === v
  );
}
export function evidenceUrl(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 1000) return false;
  try {
    const u = new URL(v);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      !u.search &&
      !u.hash &&
      /^[a-z][a-z0-9.-]+\.[a-z]{2,}$/.test(u.hostname) &&
      !u.hostname.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}
export function validObservation(v: unknown): v is ObservedForeignAmount {
  return (
    object(v) &&
    keys(v, [
      "currencyCode",
      "minorAmount",
      "minorUnits",
      "observedAt",
      "source",
    ]) &&
    typeof v.currencyCode === "string" &&
    Object.prototype.hasOwnProperty.call(evidenceMinorUnits, v.currencyCode) &&
    v.minorUnits === evidenceMinorUnits[v.currencyCode as EvidenceCurrency] &&
    Number.isSafeInteger(v.minorAmount) &&
    Number(v.minorAmount) > 0 &&
    evidenceInstant(v.observedAt) &&
    object(v.source) &&
    keys(v.source, ["id", "url", "authority"]) &&
    typeof v.source.id === "string" &&
    /^[a-z0-9-]{1,100}$/.test(v.source.id) &&
    v.source.authority === "official-operator" &&
    evidenceUrl(v.source.url)
  );
}
function decimal(v: unknown): { n: bigint; d: bigint } | undefined {
  if (typeof v !== "string" || !/^(?:0|[1-9]\d{0,6})(?:\.\d{1,8})?$/.test(v))
    return;
  const [whole, fraction = ""] = v.split(".");
  const n = BigInt(whole + fraction);
  return n > BigInt(0)
    ? { n, d: BigInt(10) ** BigInt(fraction.length) }
    : undefined;
}
export function validateFxData(value: unknown): FxData {
  const fail = (): never => {
    throw Error("invalid-fx-snapshot");
  };
  if (
    !object(value) ||
    !keys(value, ["schemaVersion", "records"]) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.records)
  )
    return fail();
  const ids = new Set<string>();
  for (const s of value.records) {
    if (
      !object(s) ||
      !keys(s, [
        "id",
        "source",
        "sourceUrl",
        "sourceDate",
        "checkedAt",
        "reviewAfter",
        "reviewStatus",
        "baseCurrency",
        "rates",
      ]) ||
      typeof s.id !== "string" ||
      !/^[a-z0-9-]{1,100}$/.test(s.id) ||
      ids.has(s.id) ||
      s.source !== "ecb" ||
      !evidenceUrl(s.sourceUrl) ||
      new URL(s.sourceUrl).hostname !== "www.ecb.europa.eu" ||
      !new URL(s.sourceUrl).pathname.startsWith("/stats/") ||
      s.baseCurrency !== "EUR" ||
      !isCalendarDate(s.sourceDate) ||
      !evidenceInstant(s.checkedAt) ||
      !evidenceInstant(s.reviewAfter) ||
      !["draft", "reviewed"].includes(String(s.reviewStatus)) ||
      Date.parse(s.sourceDate) > Date.parse(s.checkedAt) ||
      Date.parse(s.checkedAt) >= Date.parse(s.reviewAfter) ||
      Date.parse(s.reviewAfter) >
        Date.parse(s.sourceDate) + FX_VALID_DAYS * day ||
      !Array.isArray(s.rates) ||
      s.rates.length !== Object.keys(evidenceMinorUnits).length
    )
      return fail();
    ids.add(s.id);
    const currencies = new Set<string>();
    for (const r of s.rates) {
      if (
        !object(r) ||
        !keys(r, ["currency", "perEuro"]) ||
        typeof r.currency !== "string" ||
        !Object.prototype.hasOwnProperty.call(evidenceMinorUnits, r.currency) ||
        currencies.has(r.currency) ||
        !decimal(r.perEuro) ||
        (r.currency === "EUR" && r.perEuro !== "1")
      )
        return fail();
      currencies.add(r.currency);
    }
  }
  return value as FxData;
}
export type ConversionResult =
  | { status: "estimate"; amount: MoneyAmount; fx: FxConversionProvenance }
  | {
      status: "unpriced";
      reason:
        | "source-invalid"
        | "stale-fx"
        | "unsupported-currency"
        | "overflow";
    };
/** Rational cross-rate; only the final target minor unit is rounded up. No markup. */
export function convertObservedAmount(
  observation: ObservedForeignAmount,
  target: unknown,
  snapshot: FxSnapshot | undefined,
  now: number,
  multiplier = 1,
): ConversionResult {
  if (
    !isCurrency(target) ||
    !Object.prototype.hasOwnProperty.call(
      evidenceMinorUnits,
      observation.currencyCode,
    )
  )
    return { status: "unpriced", reason: "unsupported-currency" };
  if (
    !validObservation(observation) ||
    !Number.isFinite(now) ||
    Date.parse(observation.observedAt) > now ||
    !Number.isSafeInteger(multiplier) ||
    multiplier < 1
  )
    return { status: "unpriced", reason: "source-invalid" };
  try {
    validateFxData({ schemaVersion: 1, records: [snapshot] });
  } catch {
    return { status: "unpriced", reason: "source-invalid" };
  }
  if (
    !snapshot ||
    snapshot.reviewStatus !== "reviewed" ||
    Date.parse(snapshot.checkedAt) > now ||
    Date.parse(snapshot.reviewAfter) <= now
  )
    return { status: "unpriced", reason: "stale-fx" };
  const validUntil = Math.min(
    fxCurrencyReviewAfter(snapshot, observation.currencyCode),
    fxCurrencyReviewAfter(snapshot, target),
  );
  if (now >= validUntil) return { status: "unpriced", reason: "stale-fx" };
  const fromRate = snapshot.rates.find(
    (r) => r.currency === observation.currencyCode,
  )!;
  const toRate = snapshot.rates.find((r) => r.currency === target)!;
  const from = decimal(fromRate.perEuro)!;
  const to = decimal(toRate.perEuro)!;
  const n =
    BigInt(observation.minorAmount) *
    BigInt(multiplier) *
    to.n *
    from.d *
    BigInt(10) ** BigInt(currencyMetadata[target].minorUnits);
  const d = to.d * from.n * BigInt(10) ** BigInt(observation.minorUnits);
  const cents = (n + d - BigInt(1)) / d;
  return cents > BigInt(Number.MAX_SAFE_INTEGER)
    ? { status: "unpriced", reason: "overflow" }
    : {
        status: "estimate",
        amount: money(Number(cents), target),
        fx: {
          id: snapshot.id,
          source: snapshot.source,
          sourceUrl: snapshot.sourceUrl,
          sourceDate: snapshot.sourceDate,
          checkedAt: snapshot.checkedAt,
          snapshotReviewAfter: snapshot.reviewAfter,
          convertedAt: new Date(now).toISOString(),
          conversionDate: new Date(now).toISOString().slice(0, 10),
          ageMilliseconds: now - Date.parse(`${snapshot.sourceDate}T00:00:00Z`),
          baseCurrency: "EUR",
          from: {
            ...fromRate,
            validityDays: fxValidityDays[fromRate.currency],
          },
          to: { ...toRate, validityDays: fxValidityDays[toRate.currency] },
          windowPolicy: FX_WINDOW_POLICY,
          appliedWindowDays: Math.min(
            fxValidityDays[fromRate.currency],
            fxValidityDays[toRate.currency],
          ),
          validUntil: new Date(validUntil).toISOString(),
        },
      };
}
