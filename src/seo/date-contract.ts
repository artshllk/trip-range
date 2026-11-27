import {
  resolveTravelDates,
  weekendsInMonth,
  type TravelDates,
} from "../domain/dates";

export type SeoDateContract =
  | { kind: "fixed-weekend" }
  | { kind: "month-weekends"; monthPolicy: "next-full-month" };

/** Calendar intent comes from one injected reference date, never render-time freshness. */
export function resolveSeoDates(
  contract: SeoDateContract,
  today: string,
): TravelDates {
  if (contract.kind === "fixed-weekend")
    return resolveTravelDates("weekend", today);
  if (
    contract.kind !== "month-weekends" ||
    contract.monthPolicy !== "next-full-month"
  )
    throw new RangeError("Unsupported SEO date contract");
  const month = resolveTravelDates("month", today).startDate.slice(0, 7);
  return { ...weekendsInMonth(month)[0], mode: "weekends", month };
}

/** One presentation boundary keeps monthly and exact-date claims consistent across the UI. */
export function seoDatePresentation(
  contract: SeoDateContract,
  dates: TravelDates,
) {
  if (contract.kind === "fixed-weekend")
    return {
      summary: `${dates.startDate} → ${dates.endDate}`,
      heading: "A weekend you can actually compare",
      description: `The displayed example is ${dates.startDate} to ${dates.endDate}: two nights, Saturday to Monday, for two adults. Exact dates stay exact. Choose your own dates or explicitly enable flexibility in the planner.`,
      evidenceNote:
        "A route discovered from a monthly fare can still be an idea worth exploring, even when no matching-date fare is available. Its flight price stays unavailable until matching evidence exists.",
    };
  if (
    dates.mode !== "weekends" ||
    !dates.month ||
    !weekendsInMonth(dates.month).length
  )
    throw new RangeError("Monthly SEO request required");
  const month = new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dates.month}-01T12:00:00Z`));
  return {
    summary: `Example month: ${month} · Saturday–Monday weekend options · each result can use a different weekend`,
    heading: `Compare weekend options during ${month}`,
    description: `These examples compare Saturday–Monday weekend options during ${month}, for two adults and two nights. Each trip shows its actual dates; different cards can use different weekends. A Saturday departure may return on a Monday in the following month.`,
    evidenceNote:
      "Only a matching fare for an allowed weekend can price a flight. Other dates remain reference information, and unpriced ideas do not count as complete trips or budget fits. Choose a particular weekend in the normal planner to compare the same dates.",
  };
}
