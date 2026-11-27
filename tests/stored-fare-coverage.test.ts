import { test } from "node:test";
import assert from "node:assert/strict";
import { neon } from "@neondatabase/serverless";
import {
  coverageCutoff,
  reproducedFares,
  storedCoverageFares,
} from "../src/server/fare-refresh-store";

// Read-only PostgreSQL integration: CTE fixtures shadow the real tables. No
// production rows are changed or used; only the existing table types are read.
// Run explicitly with DATABASE_URL; ordinary CI needs no database credentials.
test(
  "store snapshot unions runs, respects both clocks, and filters renewal before cheapest",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const real = neon(process.env.DATABASE_URL!);
    const fetches: object[] = [],
      observations: object[] = [],
      attempts: object[] = [];
    function page(
      run: string,
      endpoint: string,
      city: string,
      price: number,
      fetched: string,
      seen: string | null,
    ) {
      const id = fetches.length + 1;
      const common = {
        endpoint,
        origin: "TIA",
        destination: city,
        currency: "EUR",
      };
      fetches.push({ ...common, id, fetched_at: fetched });
      attempts.push({
        ...common,
        run_id: run,
        outcome: "stored",
        attempted_at: fetched,
      });
      observations.push({
        ...common,
        fetch_id: id,
        fetched_at: fetched,
        travellers: 1,
        actual: true,
        cabin: "economy",
        destination_airport: city,
        origin_airport: "TIA",
        departure_date: "2026-12-05",
        return_date: "2026-12-07",
        price_minor: price,
        fare_observed_at: seen,
      });
    }
    function pair(
      run: string,
      city: string,
      price: number,
      fetched: string,
      seen: string,
    ) {
      page(run, "aviasales/v3/prices_for_dates", city, price, fetched, null);
      page(run, "aviasales/v3/get_latest_prices", city, price, fetched, seen);
    }
    pair("older-run", "MIL", 1000, "2026-11-17T07:00Z", "2026-11-16T07:00Z");
    pair("newer-run", "MIL", 2000, "2026-11-18T07:00Z", "2026-11-18T06:00Z");
    pair("other-run", "BER", 3000, "2026-11-17T07:00Z", "2026-11-17T06:00Z");
    pair("after-cutoff", "LON", 1000, "2026-11-18T09:00Z", "2026-11-18T07:00Z");
    pair("stale", "VIE", 1000, "2026-11-17T07:00Z", "2026-11-10T07:00Z");
    pair("future-clock", "ROM", 1000, "2026-11-18T07:00Z", "2026-11-18T09:00Z");
    page(
      "unmatched-a",
      "aviasales/v3/prices_for_dates",
      "PAR",
      1000,
      "2026-11-18T07:00Z",
      null,
    );
    page(
      "unmatched-b",
      "aviasales/v3/get_latest_prices",
      "PAR",
      1000,
      "2026-11-18T07:00Z",
      "2026-11-18T06:00Z",
    );
    const fixtureSql = (async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      const query = strings.reduce(
        (s, part, i) => s + (i ? "$" + (i + 3) : "") + part,
        "",
      );
      const fixture = `with fare_fetches as (select * from jsonb_populate_recordset(null::public.fare_fetches,$1::jsonb)),
      fare_observations as (select * from jsonb_populate_recordset(null::public.fare_observations,$2::jsonb)),
      warm_attempts as (select * from jsonb_populate_recordset(null::public.warm_attempts,$3::jsonb)), owned`;
      return real.query(query.replace(/^with owned/, fixture), [
        JSON.stringify(fetches),
        JSON.stringify(observations),
        JSON.stringify(attempts),
        ...values,
      ]);
    }) as unknown as Parameters<typeof storedCoverageFares>[0];
    const at = "2026-11-18T08:00:00Z";
    const fares = await storedCoverageFares(fixtureSql, "TIA", "2026-12", at);
    assert.deepEqual(
      fares.map((f) => [f.destination, f.partyCents]),
      [
        ["BER", 6000],
        ["MIL", 2000],
      ],
    );
    const renewed = await storedCoverageFares(
      fixtureSql,
      "TIA",
      "2026-12",
      at,
      "2026-11-18T00:00:00Z",
    );
    assert.deepEqual(
      renewed.map((f) => [f.destination, f.partyCents]),
      [["MIL", 4000]],
    );
    const withoutNewer = await storedCoverageFares(
      fixtureSql,
      "TIA",
      "2026-12",
      at,
      "2026-11-18T00:00:00Z",
      "newer-run",
    );
    assert.deepEqual(
      withoutNewer,
      [],
      "a sweep cannot count its own stored pages as pre-existing evidence",
    );
    const oneRun = await reproducedFares(
      fixtureSql,
      "older-run",
      "TIA",
      "2026-12",
      at,
    );
    assert.deepEqual(
      oneRun.map((f) => f.destination),
      ["MIL"],
    );
    assert.equal(
      await coverageCutoff(real, "2026-11-18"),
      "2026-11-18T08:00:00.000Z",
    );
    assert.equal(
      await coverageCutoff(real, "2027-07-18"),
      "2027-07-18T07:00:00.000Z",
    );
  },
);

test(
  "a city-market origin accepts its own airports and still excludes a conflicting one",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const real = neon(process.env.DATABASE_URL!);
    const fetches: object[] = [],
      observations: object[] = [],
      attempts: object[] = [];
    function page(endpoint: string, city: string, airport: string | null) {
      const id = fetches.length + 1;
      const fetched = "2026-11-18T07:00Z";
      const common = {
        endpoint,
        origin: "LON",
        destination: city,
        currency: "EUR",
      };
      fetches.push({ ...common, id, fetched_at: fetched });
      attempts.push({
        ...common,
        run_id: "run",
        outcome: "stored",
        attempted_at: fetched,
      });
      observations.push({
        ...common,
        fetch_id: id,
        fetched_at: fetched,
        travellers: 1,
        actual: true,
        cabin: "economy",
        destination_airport: city,
        origin_airport: airport,
        departure_date: "2026-12-05",
        return_date: "2026-12-07",
        price_minor: 1000,
        fare_observed_at:
          endpoint === "aviasales/v3/get_latest_prices"
            ? "2026-11-18T06:00Z"
            : null,
      });
    }
    for (const [city, airport] of [
      ["TIA", "LHR"],
      ["ROM", "STN"],
      ["BER", "MAN"],
    ]) {
      page("aviasales/v3/prices_for_dates", city, airport);
      page("aviasales/v3/get_latest_prices", city, null);
    }
    const fixtureSql = (async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      const query = strings.reduce(
        (s, part, i) => s + (i ? "$" + (i + 3) : "") + part,
        "",
      );
      const fixture = `with fare_fetches as (select * from jsonb_populate_recordset(null::public.fare_fetches,$1::jsonb)),
      fare_observations as (select * from jsonb_populate_recordset(null::public.fare_observations,$2::jsonb)),
      warm_attempts as (select * from jsonb_populate_recordset(null::public.warm_attempts,$3::jsonb)), owned`;
      return real.query(query.replace(/^with owned/, fixture), [
        JSON.stringify(fetches),
        JSON.stringify(observations),
        JSON.stringify(attempts),
        ...values,
      ]);
    }) as unknown as Parameters<typeof storedCoverageFares>[0];
    const fares = await storedCoverageFares(
      fixtureSql,
      "LON",
      "2026-12",
      "2026-11-18T08:00:00Z",
    );
    assert.deepEqual(
      fares.map((f) => f.destination),
      ["ROM", "TIA"],
      "Manchester is not a London origin airport",
    );
  },
);
