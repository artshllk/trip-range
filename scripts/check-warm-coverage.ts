import { appendFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { referenceCalendarDate, isCalendarDate } from "../src/domain/dates";
import {
  discoveryMonths,
  monthDestinations,
} from "../src/domain/month-discovery";
import {
  collectorOrigins,
  originNights,
  refreshEndpoint,
  refreshHealth,
} from "../src/domain/fare-refresh";
import {
  coverageCutoff,
  storedCoverageFares,
} from "../src/server/fare-refresh-store";

async function main() {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL is required");
  const sql = neon(process.env.DATABASE_URL);
  const index = process.argv.indexOf("--on");
  const day =
    index < 0 ? referenceCalendarDate(new Date()) : process.argv[index + 1];
  if (!isCalendarDate(day)) throw Error("Expected --on YYYY-MM-DD");
  const at = await coverageCutoff(sql, day);
  if (Date.parse(at) > Date.now())
    throw Error("Daily 09:00 Belgrade cutoff has not occurred");
  const sinceIndex = process.argv.indexOf("--renewed-since");
  const since = sinceIndex < 0 ? undefined : process.argv[sinceIndex + 1];
  if (
    sinceIndex >= 0 &&
    (!since ||
      !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(since) ||
      !Number.isFinite(Date.parse(since)) ||
      Date.parse(since) > Date.parse(at))
  ) {
    throw Error("Expected --renewed-since ISO timestamp at or before cutoff");
  }
  // Default stays Tirana, the launch-gate origin. --origin ALL measures every
  // collected origin at the same fixed cutoff; --origin LON,MIL picks some.
  const originIndex = process.argv.indexOf("--origin");
  const requested =
    originIndex < 0 ? "TIA" : (process.argv[originIndex + 1] ?? "");
  const origins = requested === "ALL" ? collectorOrigins : requested.split(",");
  if (!origins.length || origins.some((o) => !collectorOrigins.includes(o)))
    throw Error("Expected --origin ALL or configured origin codes");
  // Stay lengths: --nights ALL measures each origin's collected lengths (the gate is
  // per origin and length: 10+ destinations and 3+ with more than one date, on the
  // same thresholds, owner decision 27 November 2026); --nights 2,3 picks some.
  // Default 2, the only length before variable trip length.
  const nightsIndex = process.argv.indexOf("--nights");
  const nightsArg =
    nightsIndex < 0 ? "2" : (process.argv[nightsIndex + 1] ?? "");
  const lengthsFor = (origin: string) =>
    nightsArg === "ALL"
      ? originNights(origin)
      : nightsArg.split(",").map(Number);
  if (
    nightsArg !== "ALL" &&
    lengthsFor("").some((n) => !Number.isInteger(n) || n < 1 || n > 30)
  )
    throw Error("Expected --nights ALL or a list such as 2,3");
  for (const origin of origins)
    for (const nights of lengthsFor(origin))
      for (const month of discoveryMonths(day)) {
        const rows = await storedCoverageFares(
          sql,
          origin,
          month,
          at,
          undefined,
          undefined,
          nights,
        );
        const cities = monthDestinations(
          rows,
          month,
          day,
          Date.parse(at),
          600,
          nights,
        );
        const [latest] = await sql`select run_id,outcome,attempted_at,
      max(attempted_at) filter(where outcome='stored') over() as last_success
      from warm_attempts where endpoint=${refreshEndpoint} and origin=${origin}
      and departure_month=${month} and attempted_at<=${at}::timestamptz
      order by attempted_at desc,id desc limit 1`;
        // Renewal filtering happens in SQL before choosing a cheapest option per date.
        const renewed = since
          ? monthDestinations(
              await storedCoverageFares(
                sql,
                origin,
                month,
                at,
                since,
                undefined,
                nights,
              ),
              month,
              day,
              Date.parse(at),
              600,
              nights,
            )
          : undefined;
        const summarize = (items: typeof cities) => ({
          destinations: items.length,
          multiple: items.filter((c) => c.options.length >= 2).length,
          distinctCityDatePairs: items.reduce(
            (n, c) => n + c.options.length,
            0,
          ),
          datesPerCity: Object.fromEntries(
            items.map((c) => [c.destination, c.options.length]),
          ),
          coveragePass:
            items.length >= 10 &&
            items.filter((c) => c.options.length >= 2).length >= 3,
          cities: items,
        });
        const report = {
          day,
          origin,
          nights,
          month,
          measuredAt: at,
          generatedAt: new Date().toISOString(),
          source: "matched collector evidence stored by cutoff across all runs",
          ...summarize(cities),
          collection: {
            health: refreshHealth(
              latest as Parameters<typeof refreshHealth>[0],
              latest?.last_success,
              Date.parse(at),
            ),
            lastAttempt: latest?.attempted_at ?? null,
            lastSuccess: latest?.last_success ?? null,
          },
          ...(renewed
            ? { renewal: { observedSince: since, ...summarize(renewed) } }
            : {}),
        };
        const line = JSON.stringify(report);
        console.log(line);
        if (process.env.GITHUB_STEP_SUMMARY)
          appendFileSync(process.env.GITHUB_STEP_SUMMARY, "\n" + line + "\n");
      }
}
main().catch(() => {
  console.error(
    "coverage check failed: could not measure the requested store cutoff; check arguments and database availability",
  );
  process.exitCode = 1;
});
