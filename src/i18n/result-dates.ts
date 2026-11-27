import { isCalendarDate } from "../domain/dates";
import type { Locale } from "./config";

// Explicit month labels avoid server/browser ICU differences, particularly for SQ.
const months = {
  en: [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ],
  sq: [
    "jan",
    "shk",
    "mar",
    "pri",
    "maj",
    "qer",
    "korr",
    "gush",
    "sht",
    "tet",
    "nën",
    "dhj",
  ],
} as const;

export function resultMonth(month: string, locale: Locale) {
  if (!isCalendarDate(`${month}-01`)) return month;
  return `${months[locale][Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/** Labels only: actual ISO dates still determine pricing, URLs and handoffs. */
export function resultDateLabels(
  start: string,
  end: string,
  locale: Locale,
  currentYear: string,
) {
  if (!isCalendarDate(start) || !isCalendarDate(end)) return { start, end };
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const label = (date: string, year: boolean) =>
    `${Number(date.slice(8))} ${months[locale][Number(date.slice(5, 7)) - 1]}${year ? ` ${date.slice(0, 4)}` : ""}`;
  const includeYear = !sameYear || end.slice(0, 4) !== currentYear;
  if (start === end)
    return { start: label(start, includeYear), end: undefined };
  return {
    start: sameMonth
      ? String(Number(start.slice(8)))
      : label(start, includeYear),
    end: label(end, includeYear),
  };
}

/** The same calendar labels as ResultDates, for compact text-only controls. */
export function resultDateRange(
  start: string,
  end: string,
  locale: Locale,
  currentYear: string,
): string {
  const labels = resultDateLabels(start, end, locale, currentYear);
  return labels.end ? `${labels.start}–${labels.end}` : labels.start;
}
