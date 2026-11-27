/** Calendar intent, not instants. UTC is used only for timezone-independent calendar arithmetic. */
export type CalendarDate = string;
export type DatePreset = "weekend" | "next-weekend" | "month" | "summer";
export type TravelDates = {
  startDate: CalendarDate;
  endDate: CalendarDate;
  flexibleDays: number;
  mode?: "weekends";
  month?: string;
};
export function isCalendarDate(value: unknown): value is CalendarDate {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}
export function addDays(value: CalendarDate, days: number): CalendarDate {
  if (!isCalendarDate(value) || !Number.isInteger(days))
    throw new RangeError("Invalid calendar date");
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function nightsBetween(start: CalendarDate, end: CalendarDate): number {
  if (!isCalendarDate(start) || !isCalendarDate(end))
    throw new RangeError("Invalid calendar date");
  return Math.round(
    (Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) /
      86400000,
  );
}
export function resolveTravelDates(
  preset: DatePreset,
  today: CalendarDate,
  nights = 2,
  flexibleDays = 0,
): TravelDates {
  if (
    !isCalendarDate(today) ||
    !Number.isInteger(nights) ||
    nights < 1 ||
    nights > 14 ||
    ![0, 3].includes(flexibleDays)
  )
    throw new RangeError("Invalid travel dates");
  const date = new Date(`${today}T12:00:00Z`);
  let startDate: CalendarDate;
  if (preset === "month") {
    const month = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 12),
    );
    startDate = month.toISOString().slice(0, 10);
  } else if (preset === "summer") {
    const year = date.getUTCFullYear() + (today.slice(5) > "06-01" ? 1 : 0);
    startDate = `${year}-06-01`;
  } else {
    // This weekend means the next Saturday, including today when today is Saturday.
    startDate = addDays(
      today,
      ((6 - date.getUTCDay() + 7) % 7) + (preset === "next-weekend" ? 7 : 0),
    );
  }
  return { startDate, endDate: addDays(startDate, nights), flexibleDays };
}

/** Saturdays departing within the chosen month, with Monday returns. */
export function weekendsInMonth(
  month: string,
  notBefore = "0000-01-01",
): TravelDates[] {
  if (!/^\d{4}-\d{2}$/.test(month) || !isCalendarDate(`${month}-01`)) return [];
  const result: TravelDates[] = [];
  for (
    let day = `${month}-01`;
    day.slice(0, 7) === month;
    day = addDays(day, 1)
  ) {
    if (day >= notBefore && new Date(`${day}T12:00:00Z`).getUTCDay() === 6)
      result.push({
        startDate: day,
        endDate: addDays(day, 2),
        flexibleDays: 0,
      });
  }
  return result;
}

/** Product calendar at a caller-supplied clock boundary. */
export function referenceCalendarDate(now: Date): CalendarDate {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Compact, timezone-independent stay label, including the year across year boundaries. */
export function stayDateLabel(checkIn: string, checkOut: string): string {
  if (!isCalendarDate(checkIn) || !isCalendarDate(checkOut))
    return "your dates";
  const start = new Date(`${checkIn}T12:00:00Z`);
  const end = new Date(`${checkOut}T12:00:00Z`);
  const format = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    ...(checkIn.slice(0, 4) !== checkOut.slice(0, 4)
      ? { year: "numeric" as const }
      : {}),
  });
  return checkIn.slice(0, 7) === checkOut.slice(0, 7)
    ? `${start.getUTCDate()}–${format.format(end)}`
    : `${format.format(start)}–${format.format(end)}`;
}
