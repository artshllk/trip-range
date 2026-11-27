import { isCurrency, parsePlanningBudget } from "../money/currency";
import { parseRequest, type Query } from "../request";
import { locations, findLocation } from "../../catalogue/locations";
import { decodeLocation } from "../locations";
import { isCalendarDate, nightsBetween, weekendsInMonth } from "../dates";
import type { ClarificationField } from "./intent";
export function readDraftQuery(value: unknown): Query | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const pairs = Object.entries(value);
  if (
    pairs.length > 32 ||
    pairs.some(
      ([k, v]) => k.length > 30 || typeof v !== "string" || v.length > 1600,
    )
  )
    return;
  return Object.fromEntries(pairs) as Query;
}
export function validateDraft(q: Query, today: string) {
  const request = parseRequest(q, locations, today);
  const fields: ClarificationField[] = [];
  const origin =
    decodeLocation(
      typeof q.originPlace === "string" ? q.originPlace : undefined,
    ) ?? findLocation(typeof q.origin === "string" ? q.origin : undefined);
  if (!origin || origin.type === "country") fields.push("origin");
  if (
    q.toPlace !== undefined &&
    !decodeLocation(typeof q.toPlace === "string" ? q.toPlace : undefined)
  )
    fields.push("destination");
  const budget = typeof q.budget === "string" ? q.budget : "";
  if (!parsePlanningBudget(budget, request.budget.currency))
    fields.push("budget");
  if (q.currency !== undefined && !isCurrency(q.currency))
    fields.push("currency");
  if (
    !/^\d+$/.test(String(q.adults)) ||
    Number(q.adults) < 1 ||
    Number(q.adults) > 8 ||
    !/^\d+$/.test(String(q.children)) ||
    Number(q.children) < 0 ||
    Number(q.children) > 6
  )
    fields.push("party");
  if (q.dateMode === "weekends") {
    if (typeof q.month !== "string" || !weekendsInMonth(q.month, today).length)
      fields.push("dates");
  } else if (
    !isCalendarDate(q.start) ||
    !isCalendarDate(q.end) ||
    q.start < today ||
    nightsBetween(q.start, q.end) < 1 ||
    nightsBetween(q.start, q.end) > 14 ||
    !["0", "3"].includes(String(q.flexDays))
  )
    fields.push("dates");
  return { request, fields };
}
