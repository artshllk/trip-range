import { referenceCalendarDate } from "../domain/dates";
import { reportDiagnostic } from "../server/observability";
import { departureCode } from "../domain/airports";
import { findLocation } from "../catalogue/locations";
import { planningCurrency } from "../domain/market/policy";
import "server-only";
import { notFound } from "next/navigation";
import { boundedSearchQuery } from "../domain/request-limits";
import { connection } from "next/server";
import { locations } from "../catalogue/locations";
import { parseRequest, type Query } from "../domain/request";
/** One reference clock at the server boundary, using the product's documented calendar timezone. */
export function referenceToday(now = new Date()): string {
  return referenceCalendarDate(now);
}
export async function currentRequest(query: Query = {}) {
  if (!boundedSearchQuery(query)) notFound();
  await connection();
  const request = parseRequest(query, locations, referenceToday());
  const origin = request.origin ?? findLocation(request.originId);
  reportDiagnostic({
    level: "debug",
    component: "search",
    operation: "request-normalization",
    status: "ready",
    currency: request.budget.currency,
    originCode: origin ? departureCode(origin) : undefined,
  });
  reportDiagnostic({
    level: "debug",
    component: "money",
    operation: "currency-policy",
    status:
      planningCurrency(origin).source === "fallback" ? "fallback" : "ready",
    currency: request.budget.currency,
  });
  return request;
}
