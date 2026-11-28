import config from "../config/fare-warm.json";
import { addDays, nightsBetween } from "./dates";
import { nextMonth } from "./month-discovery";

export const refreshEndpoint = "triprange/exact-two-night-refresh-v1";

type Origin = {
  code: string;
  currency: string;
  airports?: string[];
  /** Stay lengths collected for this origin (owner decision, 27 November 2026). */
  nights?: number[];
};
/** Collected city markets, in configured order. */
export const collectorOrigins: string[] = (config.origins as Origin[]).map(
  (o) => o.code,
);
/**
 * Airports that belong to an origin's city market. An itinerary whose explicit
 * origin airport is outside this list is a conflicting origin and is excluded.
 * Unlisted markets (and single-airport cities) accept only their own code, which
 * is exactly the previous TIA/PRN rule.
 */
export function originAirports(origin: string): string[] {
  const entry = (config.origins as Origin[]).find((o) => o.code === origin);
  return entry?.airports?.length ? entry.airports : [origin];
}

/** Stay lengths collected for an origin; two nights when unlisted. */
export function originNights(origin: string): number[] {
  const entry = (config.origins as Origin[]).find((o) => o.code === origin);
  return entry?.nights?.length ? entry.nights : [2];
}

/**
 * Highest single-ticket fare kept (storage option B, owner decision 28 November
 * 2026): €1,200 per ticket, whatever the party size. Measured on 3 days of stored
 * fares, it drops 3.0% of rows (median ticket €287, 90th percentile €732, 99th
 * €1,611). €800 would have dropped 8.4%, mostly long-haul from London and Barcelona.
 * A budget that would allow a higher fare per person is told so on the page, never
 * shown an empty result as if nothing exists.
 */
export const MAX_TICKET_CENTS = 120_000;

/**
 * Storage options A and B (owner decisions, 27 and 28 November 2026). A normalized
 * fare row is stored only when it is a return of a length this origin collects (A)
 * and one ticket costs at most MAX_TICKET_CENTS (B). Nothing else is ever read. The
 * provider's raw reply is still stored complete, so the evidence is unchanged.
 */
export function storableRow(
  row: {
    departureDate: string;
    returnDate: string | null;
    priceMinor: number;
    currency: string;
  },
  origin: string,
): boolean {
  if (!row.returnDate || row.currency !== "EUR") return false;
  let nights: number;
  try {
    nights = nightsBetween(row.departureDate, row.returnDate);
  } catch {
    return false;
  }
  if (!originNights(origin).includes(nights)) return false;
  return (
    Number.isSafeInteger(row.priceMinor) &&
    row.priceMinor > 0 &&
    row.priceMinor <= MAX_TICKET_CENTS
  );
}

/**
 * More wrong-origin rows than this in one origin-month sweep fail that month. The
 * 20 November screen saw isolated provider mislabels (Milan: 4 Parma rows over four
 * pages; New York: 2 Stewart rows) and one systematic one (Dubai: 231 Sharjah rows
 * over 153 pages, up to 13 on a page). Ten passes the isolated cases with headroom
 * and fails the systematic one, which needs a person to look at the market.
 */
export const wrongOriginLimit = 10;

/**
 * Separate provider rows that state a different origin from the requested market.
 * Parsing labels every row with the requested origin, so a contradicting row must be
 * removed before parsing; it is never stored as an observation. Rows without an
 * explicit origin keep the existing behaviour. `wrong` counts by stated origin and,
 * when given, origin airport ("PMF" or "PMF/PMF").
 */
export function splitWrongOrigin(rows: unknown[], origin: string) {
  const kept: unknown[] = [];
  const wrong: Record<string, number> = {};
  for (const row of rows) {
    const r = row as { origin?: unknown; origin_airport?: unknown } | null;
    if (r && typeof r === "object" && r.origin && r.origin !== origin) {
      const key =
        String(r.origin) +
        (r.origin_airport ? "/" + String(r.origin_airport) : "");
      wrong[key] = (wrong[key] ?? 0) + 1;
    } else kept.push(row);
  }
  return { kept, wrong };
}
export function monthDays(month: string, today: string) {
  const dates: string[] = [];
  for (
    let day = month + "-01";
    day < nextMonth(month) + "-01";
    day = addDays(day, 1)
  ) {
    if (day >= today) dates.push(day);
  }
  return dates;
}

// Freeze the same ordinary Fridays for two successive weekly observations.
// Both observations use dates 3–8 weeks ahead. Exclude the Christmas/New Year period.
export function reassessment(today: string) {
  const days = nightsBetween(config.prishtinaAnchor, today);
  const cohort = addDays(config.prishtinaAnchor, Math.floor(days / 14) * 14);
  const week = addDays(cohort, days % 14 < 7 ? 0 : 7);
  const dates: string[] = [];
  for (let i = 28; i <= 56 && dates.length < 4; i++) {
    const date = addDays(cohort, i);
    if (new Date(date + "T12:00Z").getUTCDay() !== 5) continue;
    const md = date.slice(5);
    if (md >= "12-20" || md <= "01-04") continue;
    dates.push(date);
  }
  return { week, cohort, dates };
}

export type RefreshReceipt = {
  outcome: string;
  attempted_at: string | Date;
  run_id: string;
};
export function refreshHealth(
  receipt: RefreshReceipt | undefined,
  lastSuccess: string | Date | undefined,
  now: number,
) {
  if (receipt?.outcome === "failed") return "failed";
  if (
    !lastSuccess ||
    now - new Date(lastSuccess).getTime() >
      (config.refreshHours + config.graceHours) * 3600000
  )
    return "overdue";
  return "current";
}

function olderThan(
  lastSuccess: string | Date | null | undefined,
  now: number,
  hours: number,
) {
  const last = lastSuccess ? new Date(lastSuccess).getTime() : NaN;
  return !Number.isFinite(last) || last > now || now - last > hours * 3600000;
}

// A failed attempt does not reset the clock. Each month must have a successful
// completion; otherwise an hourly trigger collects it again after
// refreshHours + graceHours (14 hours at two sweeps a day).
export function catchUpDue(
  lastSuccess: string | Date | null | undefined,
  now: number,
) {
  return olderThan(lastSuccess, now, config.refreshHours + config.graceHours);
}

// Regular sweeps arrive from two triggers (QStash and GitHub's fallback cron), and
// GitHub's can be hours late. A sweep therefore collects a month only when its last
// success is older than refreshHours - graceHours (10 hours): the next on-time sweep
// (~12 hours later) still runs, while a duplicate or late fallback makes no calls.
export function sweepDue(
  lastSuccess: string | Date | null | undefined,
  now: number,
) {
  return olderThan(lastSuccess, now, config.refreshHours - config.graceHours);
}

export type CollectionMode = "sweep" | "catch-up" | "force";
/** Whether this trigger should collect a month, given its last successful completion. */
export function collectionDue(
  mode: CollectionMode,
  lastSuccess: string | Date | null | undefined,
  now: number,
) {
  if (mode === "force") return true;
  return mode === "sweep"
    ? sweepDue(lastSuccess, now)
    : catchUpDue(lastSuccess, now);
}

/**
 * Whether an origin-month's outcome fails the collector run. "stopped" (the 900 MiB
 * storage stop) is the design working, not a failure: the run stays green and the
 * 20-hour stall alert escalates if no month completes (owner, 28 November 2026).
 */
export function outcomeFailsRun(outcome: string) {
  return (
    outcome !== "complete" && outcome !== "skipped" && outcome !== "stopped"
  );
}

/** Hours without a full successful collection before the watchdog raises an issue. */
export const stallHours = 20;

export type StallItem = {
  origin: string;
  month: string;
  lastSuccess: string | null;
  ageHours: number;
};

/**
 * Watchdog rule. Every configured origin's current and next month must have a
 * successful completion within `hours`. The oldest of those completions is when the
 * last fully successful sweep finished, so the check also catches one origin failing
 * repeatedly while the others succeed. A month that has never succeeded (the new
 * "next month" on the 1st) is measured from the start of the current month, UTC, so
 * a month boundary does not raise a false alarm before the first sweep reaches it.
 */
export function collectionStall(
  lastSuccess: Record<string, string | Date | null | undefined>,
  origins: string[],
  months: string[],
  now: number,
  hours = stallHours,
) {
  const entered = Date.parse(months[0] + "-01T00:00:00Z");
  const items: StallItem[] = origins.flatMap((origin) =>
    months.map((month) => {
      const raw = lastSuccess[origin + "|" + month];
      const last = raw ? new Date(raw).getTime() : NaN;
      const since = Number.isFinite(last) && last <= now ? last : entered;
      return {
        origin,
        month,
        lastSuccess: Number.isFinite(last)
          ? new Date(last).toISOString()
          : null,
        ageHours: Math.round(((now - since) / 3600000) * 10) / 10,
      };
    }),
  );
  const oldest = items.reduce((a, b) => (b.ageHours > a.ageHours ? b : a));
  return {
    stale: items.some((i) => i.ageHours > hours),
    hours,
    oldest,
    items,
  };
}
