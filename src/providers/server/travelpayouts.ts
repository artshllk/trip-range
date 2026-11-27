import type { DiagnosticEvent } from "../../server/observability/diagnostic";
import { reportDiagnostic } from "../../server/observability";
import "server-only";
import type { FlightDiscoveryProvider } from "../contracts";
import type { FlightDiscovery, FlightDiscoveryFare } from "../../domain/types";
import {
  observationQuality,
  observationTimestamp,
  providerFoundAt,
  classifyFareEvidence,
  fareDateMatch,
} from "../../domain/fare-evidence";
import { isCalendarDate } from "../../domain/dates";
import { parseMoney } from "../../domain/money/currency";
import { travelpayoutsMarket, providerCurrency } from "./travelpayouts-policy";
import { record, type ProviderFetch, systemClock } from "./http";
import { createFlightHttp, type FlightHttp } from "./flight-http";
export { FLIGHT_CACHE_SECONDS } from "./flight-http";
export const FLIGHT_RESPONSE_LIMIT = 100;

/** The single query shape for prices_for_dates: user searches and the warm job send the same parameters. */
export function pricesForDatesUrl(q: {
  origin: string;
  destination?: string;
  departureMonth: string;
  returnMonth?: string;
  currency: string;
}) {
  const url = new URL(
    "https://api.travelpayouts.com/aviasales/v3/prices_for_dates",
  );
  url.search = new URLSearchParams({
    origin: q.origin,
    departure_at: q.departureMonth,
    ...(q.returnMonth ? { return_at: q.returnMonth } : {}),
    ...(q.destination ? { destination: q.destination } : {}),
    one_way: "false",
    currency: q.currency.toLowerCase(),
    sorting: "price",
    unique: "false",
    limit: String(FLIGHT_RESPONSE_LIMIT),
    page: "1",
    market: travelpayoutsMarket.code,
  }).toString();
  return url;
}
/**
 * found_at + actual for itineraries: prices_for_dates has neither, this endpoint has both.
 * With `month`, one calendar month; without, period_type=year (one call per route).
 */
export function latestPricesUrl(q: {
  origin: string;
  destination?: string;
  month?: string;
  currency: string;
}) {
  const url = new URL(
    "https://api.travelpayouts.com/aviasales/v3/get_latest_prices",
  );
  url.search = new URLSearchParams({
    origin: q.origin,
    ...(q.destination ? { destination: q.destination } : {}),
    ...(q.month
      ? { beginning_of_period: `${q.month}-01`, period_type: "month" }
      : { period_type: "year" }),
    one_way: "false",
    currency: q.currency.toLowerCase(),
    sorting: "price",
    limit: "1000",
    page: "1",
    show_to_affiliates: "true",
  }).toString();
  return url;
}
/** Cached fares from airports near the origin (and destination). Max limit: 7. */
export function nearestPlacesUrl(q: {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  currency: string;
}) {
  const url = new URL(
    "https://api.travelpayouts.com/v2/prices/nearest-places-matrix",
  );
  url.search = new URLSearchParams({
    origin: q.origin,
    destination: q.destination,
    depart_date: q.departureDate,
    return_date: q.returnDate,
    currency: q.currency.toLowerCase(),
    distance: "500",
    limit: "7",
    flexibility: "3",
    show_to_affiliates: "true",
  }).toString();
  return url;
}
export const LATEST_PRICES_ENDPOINT = "aviasales/v3/get_latest_prices";
/** Same itinerary and the same price: destination, local dates, minor units. */
const itineraryKey = (
  destination: string,
  departure: string,
  ret: string,
  price: number,
) =>
  `${destination}|${departure.slice(0, 10)}|${ret.slice(0, 10)}|${Math.round(price * 100)}`;
type Observation = { foundAt: string | null; actual?: boolean };
function observationIndex(body: unknown): Map<string, Observation> {
  const index = new Map<string, Observation>();
  if (!record(body) || body.success !== true || !Array.isArray(body.data))
    return index;
  for (const row of body.data) {
    if (
      !record(row) ||
      typeof row.destination !== "string" ||
      typeof row.depart_date !== "string" ||
      typeof row.return_date !== "string" ||
      typeof row.value !== "number"
    )
      continue;
    const key = itineraryKey(
      row.destination,
      row.depart_date,
      row.return_date,
      row.value,
    );
    const foundAt = providerFoundAt(row.found_at);
    const previous = index.get(key);
    // Several observations of one itinerary at one price: keep the newest.
    if (
      !previous ||
      (foundAt && (!previous.foundAt || foundAt > previous.foundAt))
    )
      index.set(key, {
        foundAt,
        // Read and honoured, but unproven: never observed false yet (see fare-evidence.ts).
        actual: typeof row.actual === "boolean" ? row.actual : undefined,
      });
  }
  return index;
}
export function createTravelpayoutsDiscovery(
  token: string,
  fetcher: ProviderFetch = fetch,
  clock = systemClock,
  timeoutMs = 4000,
  diagnosticSink?: (event: DiagnosticEvent) => void,
  http: FlightHttp = createFlightHttp(
    token,
    fetcher,
    undefined,
    undefined,
    clock,
  ),
): FlightDiscoveryProvider {
  return {
    async discover(request, origin, options) {
      const code =
        origin.airportIata ?? origin.cityCode ?? origin.iataCodes?.[0];
      if (!code || !/^[A-Z]{3}$/.test(code))
        return { status: "unavailable", reason: "unsupported-origin" };
      const target =
        request.destination?.type === "country"
          ? undefined
          : request.destination;
      const destinationCode =
        target?.airportIata ?? target?.cityCode ?? target?.iataCodes?.[0];
      if (destinationCode && !/^[A-Z]{3}$/.test(destinationCode))
        return { status: "unavailable", reason: "unsupported-destination" };
      const url = pricesForDatesUrl({
        origin: code,
        destination: destinationCode,
        departureMonth: request.dates.startDate.slice(0, 7),
        returnMonth:
          request.dates.mode === "weekends"
            ? undefined
            : request.dates.endDate.slice(0, 7),
        currency: request.budget.currency,
      });
      reportDiagnostic({
        level: "debug",
        component: "provider",
        operation: "provider-scope",
        status: "ready",
        originCode: code,
        currency: request.budget.currency,
        market: travelpayoutsMarket.code,
      });
      const coverage = (
        evidence: NonNullable<DiagnosticEvent["evidence"]>,
        count: number,
      ) => {
        if (count > 0)
          reportDiagnostic(
            {
              level: "info",
              component: "provider",
              operation: "discovery-evidence",
              status:
                evidence === "provider-empty"
                  ? "empty"
                  : evidence === "provider-failed" ||
                      evidence === "schema-invalid"
                    ? "unavailable"
                    : evidence === "stale-fare"
                      ? "stale"
                      : evidence === "observation-unconfirmed"
                        ? "unconfirmed"
                        : evidence === "currency-rejected"
                          ? "mismatch"
                          : "ready",
              provider: "travelpayouts",
              evidence,
              count,
              originCode: code,
              destinationCode,
              currency: request.budget.currency,
              market: travelpayoutsMarket.code,
              dateMode:
                request.dates.mode ??
                (request.dates.flexibleDays ? "flexible" : "exact"),
            },
            diagnosticSink,
          );
      };
      const budgetMs = Math.max(
        1,
        Math.min(timeoutMs, options?.timeoutMs ?? timeoutMs),
      );
      // Itineraries and deep links from prices_for_dates; found_at and actual from
      // get_latest_prices, joined below. The second call failing only loses the
      // observation time, never the fare.
      const [result, latest] = await Promise.all([
        http(url.toString(), budgetMs, options?.signal),
        http(
          latestPricesUrl({
            origin: code,
            destination: destinationCode,
            month: request.dates.startDate.slice(0, 7),
            currency: request.budget.currency,
          }).toString(),
          budgetMs,
          options?.signal,
        ),
      ]);
      const observations = latest.ok
        ? observationIndex(latest.body)
        : new Map<string, Observation>();
      if (!result.ok) {
        coverage(
          result.reason === "malformed-response"
            ? "schema-invalid"
            : "provider-failed",
          1,
        );
        return { status: "unavailable", reason: result.reason };
      }
      const body = result.body;
      if (record(body) && body.success === false) {
        coverage("provider-failed", 1);
        return { status: "unavailable", reason: "unavailable" };
      }
      if (!record(body) || body.success !== true || !Array.isArray(body.data)) {
        coverage("schema-invalid", 1);
        return { status: "unavailable", reason: "malformed-response" };
      }
      const fares: FlightDiscoveryFare[] = [];
      if (
        body.currency !== undefined &&
        providerCurrency(request.budget.currency, [body.currency]).status !==
          "match"
      ) {
        reportDiagnostic({
          level: "warn",
          component: "provider",
          operation: "provider-currency",
          status: "mismatch",
          originCode: code,
          currency: request.budget.currency,
        });
        coverage("currency-rejected", 1);
        return { status: "unavailable", reason: "currency-mismatch" };
      }
      const checkedAt = clock();
      let malformed = 0,
        dateMismatch = 0,
        currencyRejected = 0,
        currencyFromRequest = 0;
      for (const item of body.data.slice(0, FLIGHT_RESPONSE_LIMIT)) {
        if (
          !record(item) ||
          typeof item.destination !== "string" ||
          !/^[A-Z]{3}$/.test(item.destination) ||
          typeof item.origin !== "string" ||
          !/^[A-Z]{3}$/.test(item.origin) ||
          (item.origin !== code && item.origin_airport !== code) ||
          (origin.type === "airport" &&
            (item.origin_airport ?? item.origin) !== code) ||
          (target?.type === "airport" &&
            (item.destination_airport ?? item.destination) !==
              destinationCode) ||
          // The row's city may be a metro code we don't catalogue (BSL is served
          // as EAP); the requested airport identifies the row just as well.
          (destinationCode &&
            ![destinationCode, ...(target?.iataCodes ?? [])].some(
              (c) => c === item.destination || c === item.destination_airport,
            )) ||
          [item.origin_airport, item.destination_airport].some(
            (v) =>
              v !== undefined &&
              (typeof v !== "string" || !/^[A-Z]{3}$/.test(v)),
          ) ||
          [item.transfers, item.return_transfers].some(
            (v) =>
              v !== undefined &&
              (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 8),
          ) ||
          (item.airline !== undefined &&
            (typeof item.airline !== "string" ||
              !/^[A-Z0-9]{2,3}$/.test(item.airline))) ||
          typeof item.price !== "number" ||
          !Number.isFinite(item.price) ||
          item.price <= 0 ||
          item.price > 1_000_000
        ) {
          malformed++;
          continue;
        }
        const currency = providerCurrency(
          request.budget.currency,
          [body.currency, item.currency],
          request.budget.currency,
        );
        if (currency.status !== "match") {
          currencyRejected++;
          continue;
        }
        if (body.currency === undefined && item.currency === undefined)
          currencyFromRequest++;
        const amount = parseMoney(String(item.price), request.budget.currency);
        if (!amount) {
          malformed++;
          continue;
        }
        const start =
          typeof item.departure_at === "string"
            ? item.departure_at.slice(0, 10)
            : "";
        const end =
          typeof item.return_at === "string" ? item.return_at.slice(0, 10) : "";
        if (
          !isCalendarDate(start) ||
          !isCalendarDate(end) ||
          end <= start ||
          ![item.departure_at, item.return_at].every(
            (v) =>
              typeof v === "string" &&
              (isCalendarDate(v) || observationTimestamp(v)),
          )
        ) {
          dateMismatch++;
          continue;
        }
        // prices_for_dates carries no found_at (verified against the live API); a
        // row-level found_at is ignored. Observation time comes only from the join,
        // and never from HTTP Date or retrieval time.
        const observation = observations.get(
          itineraryKey(
            item.destination,
            String(item.departure_at),
            String(item.return_at),
            item.price,
          ),
        );
        const observedAt = observation?.foundAt ?? null;
        const freshness = observationQuality(
          observedAt,
          checkedAt.valueOf(),
          observation?.actual,
        );
        fares.push({
          originCode: code,
          originAirport:
            typeof item.origin_airport === "string"
              ? item.origin_airport
              : undefined,
          destinationCode: item.destination,
          destinationAirport:
            typeof item.destination_airport === "string" &&
            /^[A-Z]{3}$/.test(item.destination_airport)
              ? item.destination_airport
              : undefined,
          price: {
            amount,
            confidence:
              freshness === "fresh" || freshness === "unobserved"
                ? "recent"
                : "estimate",
            source:
              freshness === "stale"
                ? { status: "stale", reason: "old-provider-observation" }
                : freshness === "not-actual"
                  ? { status: "unavailable", reason: "provider-not-actual" }
                  : freshness === "unconfirmed"
                    ? {
                        status: "unavailable",
                        reason: "observation-unconfirmed",
                      }
                    : { status: "available" },
            providerId: "travelpayouts-aviasales-data",
            observedAt,
            ...(observation?.actual !== undefined
              ? { providerActual: observation.actual }
              : {}),
            ...(observedAt
              ? { observationEndpoint: LATEST_PRICES_ENDPOINT }
              : {}),
            demo: false,
          },
          scope: {
            unit: "per-traveller",
            journey: "return",
            dates: { startDate: start, endDate: end, flexibleDays: 0 },
            fees: "provider-unspecified",
          },
          // When we fetched it, not when this (possibly cached) body was parsed.
          retrievedAt: result.fetchedAt ?? null,
          transfers:
            typeof item.transfers === "number" &&
            Number.isInteger(item.transfers) &&
            item.transfers >= 0
              ? item.transfers
              : undefined,
          airline:
            typeof item.airline === "string" &&
            /^[A-Z0-9]{2,3}$/.test(item.airline)
              ? item.airline
              : undefined,
        });
      }
      const value: FlightDiscovery = {
        fares,
        diagnostics: [
          { code: "malformed-row", count: malformed },
          { code: "schema-invalid", count: malformed + dateMismatch },
          { code: "currency-from-request", count: currencyFromRequest },
          {
            code: "sample-limit-reached",
            count: body.data.length >= FLIGHT_RESPONSE_LIMIT ? 1 : 0,
          },
          {
            code: "date-unmatched",
            count: fares.filter(
              (f) => fareDateMatch(f, request) === "reference",
            ).length,
          },
          { code: "date-mismatch", count: dateMismatch },
          { code: "currency-rejected", count: currencyRejected },
          { code: "provider-empty", count: body.data.length === 0 ? 1 : 0 },
          {
            code: "stale-fare",
            count: fares.filter(
              (f) => classifyFareEvidence(f, request) === "stale",
            ).length,
          },
          {
            code: "observation-unconfirmed",
            count: fares.filter(
              (f) => classifyFareEvidence(f, request) === "unconfirmed",
            ).length,
          },
          {
            code: "reference-only",
            count: fares.filter(
              (f) => classifyFareEvidence(f, request) === "reference",
            ).length,
          },
        ].filter((d) => d.count > 0) as FlightDiscovery["diagnostics"],
      };
      for (const diagnostic of value.diagnostics)
        coverage(diagnostic.code, diagnostic.count);
      reportDiagnostic({
        level: currencyRejected ? "warn" : "debug",
        component: "provider",
        operation: "provider-currency",
        status: currencyRejected ? "mismatch" : "ready",
        currency: request.budget.currency,
        originCode: code,
        count: currencyRejected,
      });
      if (body.data.length && !fares.length && currencyRejected)
        return { status: "unavailable", reason: "currency-mismatch" };
      if (body.data.length && !fares.length && (malformed || dateMismatch))
        return { status: "unavailable", reason: "malformed-response" };
      return { status: "available", value };
    },
  };
}
