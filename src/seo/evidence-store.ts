import type { NeonQueryFunction } from "@neondatabase/serverless";
import { hubEvidenceRule, type HubEvidence } from "./indexing";

/**
 * Review-time readers over the fare store. Read-only, repeatable-read; never
 * called while rendering, so no provider or store state reaches robots.
 * Only return-trip rows the provider did not mark stale (`actual = false`).
 */
type Sql = NeonQueryFunction<false, false>;
const code = (v: string) => /^[A-Z]{3}$/.test(v);

/** Destinations from one origin with a current stored return fare for a future departure. */
export async function readHubEvidence(
  sql: Sql,
  origin: string,
  priceable: ReadonlySet<string>,
  snapshotAt = new Date().toISOString(),
): Promise<HubEvidence> {
  if (!code(origin)) throw new RangeError("Origin must be an IATA code");
  const [rows] = await sql.transaction(
    (tx) => [
      tx`select distinct trim(destination) as destination
        from fare_observations
        where origin = ${origin}
          and return_date is not null
          and actual is distinct from false
          and departure_date > ${snapshotAt}::timestamptz::date
          and fetched_at > ${snapshotAt}::timestamptz - make_interval(days => ${hubEvidenceRule.maxFetchAgeDays})
          and fetched_at <= ${snapshotAt}::timestamptz`,
    ],
    { readOnly: true, isolationLevel: "RepeatableRead" },
  );
  return {
    kind: "hub-v1",
    source: "fare-store",
    snapshotAt,
    originCode: origin,
    qualifyingDestinations: rows
      .map((r) => String(r.destination))
      .filter((d) => priceable.has(d))
      .sort(),
  };
}
