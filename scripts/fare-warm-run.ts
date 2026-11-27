import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { setTimeout as pause } from "node:timers/promises";
import { neon } from "@neondatabase/serverless";
import { serverEnvironment } from "../src/providers/server/environment";
import {
  pricesForDatesUrl,
  latestPricesUrl,
} from "../src/providers/server/travelpayouts";
import {
  parseFareFetch,
  type FareObservationRecord,
} from "../src/domain/fare-store";
import { addDays, referenceCalendarDate } from "../src/domain/dates";
import {
  discoveryMonths,
  monthDestinations,
} from "../src/domain/month-discovery";
import {
  collectionDue,
  collectorOrigins,
  type CollectionMode,
  monthDays,
  originAirports,
  reassessment,
  refreshEndpoint,
  splitWrongOrigin,
  wrongOriginLimit,
} from "../src/domain/fare-refresh";
import {
  finishRefresh,
  reproducedFares,
  storeRefreshPage,
} from "../src/server/fare-refresh-store";
import { pruneFareStore } from "../src/server/fare-store";
import { collectorHttp } from "../src/server/collector-http";
import { ProviderRequestError } from "../src/providers/server/http";

const now = new Date();
const today = referenceCalendarDate(now);
const months = discoveryMonths(today);
const run = now.toISOString() + "/" + randomUUID();
const originWeek = reassessment(today);
const env = serverEnvironment();
const token = env.travelpayouts.TRAVELPAYOUTS_API_TOKEN;
const config = env.fareStore.databaseUrl;
const dry = process.argv.includes("--dry-run");
// sweep: twice-daily trigger, skips months that succeeded within 10 hours (duplicate
// or late trigger). catch-up: hourly, collects months with no success for 14 hours.
// force: deliberate manual run, collects everything. No flag keeps the old manual
// behaviour (force); --catch-up is kept for existing callers.
const modeArg = process.argv.includes("--mode")
  ? process.argv[process.argv.indexOf("--mode") + 1]
  : process.argv.includes("--catch-up")
    ? "catch-up"
    : "force";
if (!["sweep", "catch-up", "force"].includes(modeArg))
  throw Error("Expected --mode sweep|catch-up|force");
const mode = modeArg as CollectionMode;
let calls = 0;
// All origins run concurrently, so pacing must be global, not per origin. One
// provider dispatch per 300 ms is at most 200/minute (217 per rolling 65 s) across
// every endpoint, below the 300 latest-prices admission and leaving headroom for
// the planner. Shared Redis admission remains authoritative and fail-closed.
const dispatchSpacingMs = 300;
let dispatchQueue: Promise<unknown> = Promise.resolve();
function dispatchSlot() {
  const turn = dispatchQueue.then(() => pause(dispatchSpacingMs));
  dispatchQueue = turn;
  return turn;
}

async function main() {
  if (dry) {
    console.log(
      JSON.stringify({
        ...Object.fromEntries(
          collectorOrigins.map((origin) => [
            origin,
            Object.fromEntries(months.map((m) => [m, monthDays(m, today)])),
          ]),
        ),
        PRN: originWeek,
      }),
    );
    return;
  }
  if (!token || !config || !env.redis)
    throw Error(
      "Collector needs provider, database and shared Redis credentials",
    );
  // Origins run concurrently, so each origin/month counts its own dispatched calls;
  // `calls` stays the whole-run total.
  const providerToken = token;
  type Fetcher = (url: URL) => Promise<Response>;
  function counted(tally: { calls: number }): Fetcher {
    const admitted = collectorHttp(providerToken, (url, options) => {
      calls++;
      tally.calls++;
      return fetch(url, options);
    });
    return async (url) => {
      await dispatchSlot();
      return admitted(url);
    };
  }
  const sql = neon(config);
  // One per origin-month: its counted fetcher and the wrong-origin rows it dropped.
  type Source = { fetch: Fetcher; wrongOrigin: Record<string, number> };
  async function pages(
    source: Source,
    url: URL,
    consume: (rows: FareObservationRecord[]) => void,
  ) {
    const limit = 1000;
    url.searchParams.set("limit", String(limit));
    for (let page = 1; page <= 100; page++) {
      url.searchParams.set("page", String(page));
      // Local pacing reduces bursts; shared endpoint admission is authoritative.
      await pause(500);
      const response = await source.fetch(url);
      if (!response.ok) throw Error("Provider HTTP " + response.status);
      const body = await response.json();
      if (
        body.success === false ||
        !Array.isArray(body.data) ||
        (body.data.length &&
          String(body.currency ?? "EUR").toUpperCase() !== "EUR")
      )
        throw Error("Malformed provider page");
      // Parsing labels every row with the requested origin, so a row stating another
      // origin is dropped before parsing and never stored as an observation. The raw
      // reply below is still stored complete, as the provider's own evidence.
      const requested = url.searchParams.get("origin") ?? "";
      const { kept, wrong } = splitWrongOrigin(body.data, requested);
      for (const [key, count] of Object.entries(wrong))
        source.wrongOrigin[key] = (source.wrongOrigin[key] ?? 0) + count;
      const parsed = parseFareFetch(
        url.toString(),
        { ...body, data: kept },
        new Date().toISOString(),
        response.headers.get("date"),
      );
      if (!parsed || parsed.fetch.currency !== "EUR")
        throw Error("Invalid fare page");
      if (parsed.fetch.origin !== requested)
        throw Error("Provider origin mismatch");
      parsed.fetch.rawPayload = body;
      if (url.searchParams.has("departure_at")) {
        const departure = url.searchParams.get("departure_at"),
          returning = url.searchParams.get("return_at");
        if (
          parsed.observations.some(
            (row) =>
              row.departureDate !== departure || row.returnDate !== returning,
          )
        )
          throw Error("Provider returned dates outside the exact request");
      }
      await storeRefreshPage(sql, parsed, run);
      consume(parsed.observations);
      if (body.data.length < limit) return;
    }
    throw Error("Pagination incomplete");
  }

  async function collect(origin: string, month: string, dates: string[]) {
    const tally = { calls: 0 };
    const source: Source = { fetch: counted(tally), wrongOrigin: {} };
    const airports = originAirports(origin);
    const offers = new Map<string, Set<string>>();
    const stamped = new Set<string>();
    let failure: string | undefined;
    try {
      for (const day of dates) {
        const returning = addDays(day, 2);
        await pages(
          source,
          pricesForDatesUrl({
            origin,
            departureMonth: day,
            returnMonth: returning,
            currency: "EUR",
          }),
          (rows) => {
            for (const r of rows) {
              if (
                r.departureDate !== day ||
                r.returnDate !== returning ||
                !r.destinationAirport ||
                (r.originAirport && !airports.includes(r.originAirport)) ||
                r.actual === false ||
                (r.cabin && r.cabin !== "economy")
              )
                continue;
              const keys = offers.get(r.destination) ?? new Set<string>();
              keys.add(day + "|" + r.priceMinor);
              offers.set(r.destination, keys);
            }
          },
        );
      }
      for (const [destination, keys] of offers) {
        const monthly = latestPricesUrl({
          origin,
          destination,
          month,
          currency: "EUR",
        });
        const record = (rows: FareObservationRecord[]) => {
          for (const r of rows) {
            const seen = Date.parse(r.fareObservedAt ?? "");
            if (
              r.destination === destination &&
              r.returnDate === addDays(r.departureDate, 2) &&
              !Number.isNaN(seen) &&
              seen <= Date.now() &&
              Date.now() - seen <= 7 * 86400000 &&
              r.actual !== false &&
              (!r.cabin || r.cabin === "economy")
            )
              stamped.add(
                r.destination + "|" + r.departureDate + "|" + r.priceMinor,
              );
          }
        };
        await pages(source, monthly, record);
        const unmatched = new Set(
          [...keys]
            .filter((k) => !stamped.has(destination + "|" + k))
            .map((k) => k.split("|")[0]),
        );
        for (const date of unmatched) {
          const day = new URL(monthly);
          day.searchParams.set("beginning_of_period", date);
          day.searchParams.set("period_type", "day");
          await pages(source, day, record);
        }
      }
    } catch (error) {
      failure =
        error instanceof ProviderRequestError
          ? "Provider " + error.reason
          : error instanceof Error
            ? error.message.slice(0, 120)
            : "Collection failed";
    }
    const wrongRows = Object.values(source.wrongOrigin).reduce(
      (n, c) => n + c,
      0,
    );
    if (!failure && wrongRows > wrongOriginLimit)
      failure =
        "Wrong-origin rows " + wrongRows + " exceed " + wrongOriginLimit;
    // Only publish a completion receipt after the statements for all pages committed.
    const at = new Date().toISOString();
    let fares;
    try {
      fares = await reproducedFares(sql, run, origin, month, at);
    } catch (error) {
      await finishRefresh(
        sql,
        run,
        origin,
        month,
        "Stored evidence verification failed",
      );
      throw error;
    }
    const cities = monthDestinations(fares, month, today, Date.parse(at), 600);
    const report = {
      run,
      at,
      origin,
      month,
      status: failure ? "failed" : "complete",
      failure,
      datesPlanned: dates.length,
      providerCalls: tally.calls,
      wrongOrigin: source.wrongOrigin,
      wrongOriginRows: wrongRows,
      githubRunId: process.env.GITHUB_RUN_ID ?? null,
      trigger: process.env.GITHUB_EVENT_NAME ?? "local",
      schedule: process.env.COLLECTION_SCHEDULE ?? null,
      ...(origin === "PRN"
        ? {
            panel: originWeek,
            weekends: Object.fromEntries(
              dates.map((date) => [
                date,
                cities.flatMap((c) =>
                  c.options.filter((o) => o.departure === date),
                ),
              ]),
            ),
          }
        : {}),
      destinations: cities.length,
      multiple: cities.filter((c) => c.options.length > 1).length,
      departures: Object.fromEntries(
        cities.map((c) => [c.destination, c.options.map((o) => o.departure)]),
      ),
    };
    await finishRefresh(sql, run, origin, month, failure);
    console.log(JSON.stringify(report));
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        "\n" +
          origin +
          " · " +
          month +
          " · " +
          report.status +
          " · " +
          report.destinations +
          " destinations · " +
          report.multiple +
          " with multiple dates" +
          (wrongRows
            ? " · wrong-origin rows dropped: " +
              Object.entries(source.wrongOrigin)
                .map(([k, c]) => k + " ×" + c)
                .join(", ")
            : "") +
          "\n\n" +
          cities
            .map((c) => c.destination + " " + c.options.length)
            .join(" · ") +
          "\n",
      );
    if (failure) process.exitCode = 1;
    return report.status;
  }
  // Each origin sweeps its months in order; origins run side by side. A failure in
  // one origin is recorded and reported but never stops the others: every page and
  // completion receipt is already committed per origin and month.
  async function sweep(origin: string) {
    const outcome: Record<string, string> = {};
    for (const m of months) {
      if (mode !== "force") {
        const [receipt] = await sql`select max(attempted_at) as last_success
          from warm_attempts where endpoint=${refreshEndpoint} and origin=${origin}
          and departure_month=${m} and outcome='stored'`;
        if (!collectionDue(mode, receipt?.last_success, Date.now())) {
          console.log(
            JSON.stringify({
              origin,
              month: m,
              mode,
              status: "skipped",
              reason:
                mode === "sweep"
                  ? "successful refresh within ten hours"
                  : "successful refresh within fourteen hours",
            }),
          );
          outcome[m] = "skipped";
          continue;
        }
      }
      outcome[m] = await collect(origin, m, monthDays(m, today));
    }
    return outcome;
  }
  const sweeps = await Promise.allSettled(collectorOrigins.map(sweep));
  const origins: Record<string, Record<string, string>> = Object.fromEntries(
    sweeps.map((result, i) => {
      const origin = collectorOrigins[i];
      if (result.status === "fulfilled") return [origin, result.value];
      process.exitCode = 1;
      console.error(
        "fare-warm: origin " +
          origin +
          " aborted: " +
          (result.reason instanceof Error
            ? result.reason.message.slice(0, 120)
            : "failed"),
      );
      return [origin, Object.fromEntries(months.map((m) => [m, "aborted"]))];
    }),
  );
  const failedOrigins = collectorOrigins.filter((o) =>
    Object.values(origins[o]).some((v) => v !== "complete" && v !== "skipped"),
  );
  if (failedOrigins.length)
    console.error("fare-warm: failed origins " + failedOrigins.join(","));
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      "\n| Origin | " +
        months.join(" | ") +
        " |\n|---|" +
        months.map(() => "---|").join("") +
        "\n" +
        collectorOrigins
          .map(
            (o) =>
              "| " +
              o +
              " | " +
              months.map((m) => origins[o][m] ?? "not run").join(" | ") +
              " |",
          )
          .join("\n") +
        "\n",
    );
  // One paired-week panel per week, with the exact same Fridays on the second check.
  for (const m of new Set(originWeek.dates.map((d) => d.slice(0, 7)))) {
    const [done] =
      await sql`select 1 from warm_attempts where endpoint=${refreshEndpoint} and origin='PRN' and departure_month=${m} and outcome='stored' and attempted_at >= (${originWeek.week}::date::timestamp at time zone 'Europe/Belgrade') limit 1`;
    if (!done)
      await collect(
        "PRN",
        m,
        originWeek.dates.filter((date) => date.startsWith(m)),
      );
  }
  console.log(
    JSON.stringify({
      calls,
      mode,
      origins,
      failedOrigins,
      PRN: originWeek,
    }),
  );
  if (!(await pruneFareStore())) throw Error("Fare store pruning failed");
}
main().catch((error) => {
  console.error(
    "fare-warm:",
    error instanceof Error ? error.message : "failed",
  );
  process.exitCode = 1;
});
