import { neon } from "@neondatabase/serverless";
import { isCalendarDate, referenceCalendarDate } from "../src/domain/dates";
import { monthDestinations } from "../src/domain/month-discovery";
import { refreshEndpoint } from "../src/domain/fare-refresh";
import { sweepYield } from "../src/domain/sweep-yield";
import {
  reproducedFares,
  storedCoverageFares,
} from "../src/server/fare-refresh-store";

async function main() {
  if (!process.env.DATABASE_URL) throw Error("Database configuration required");
  const index = process.argv.indexOf("--from");
  const from =
    index < 0 ? referenceCalendarDate(new Date()) : process.argv[index + 1];
  if (!isCalendarDate(from)) throw Error("Expected --from YYYY-MM-DD");
  const sql = neon(process.env.DATABASE_URL);
  // Include preceding receipts as baselines, but report only requested dates.
  const receipts =
    await sql`select a.run_id,a.departure_month as month,a.outcome,a.attempted_at,
    (select count(*)::int from warm_attempts p where p.run_id=a.run_id and p.origin='TIA'
      and p.departure_month=a.departure_month and p.endpoint<>${refreshEndpoint} and p.outcome='stored') as recorded_pages
    from warm_attempts a where a.endpoint=${refreshEndpoint} and a.origin='TIA'
    order by a.attempted_at,a.id`;
  const previous = new Map<string, (typeof receipts)[number]>();
  for (const receipt of receipts) {
    const at = new Date(receipt.attempted_at).toISOString();
    const day = referenceCalendarDate(new Date(at));
    const prior = previous.get(receipt.month);
    previous.set(receipt.month, receipt);
    if (day < from) continue;
    const options = (
      rows: Awaited<ReturnType<typeof reproducedFares>>,
      when: string,
    ) =>
      monthDestinations(
        rows,
        receipt.month,
        referenceCalendarDate(new Date(when)),
        Date.parse(when),
        600,
      ).flatMap((c) => c.options);
    const current = options(
      await reproducedFares(sql, receipt.run_id, "TIA", receipt.month, at),
      at,
    );
    const previousAt = prior
      ? new Date(prior.attempted_at).toISOString()
      : null;
    const old =
      prior && previousAt
        ? options(
            await reproducedFares(
              sql,
              prior.run_id,
              "TIA",
              receipt.month,
              previousAt,
            ),
            previousAt,
          )
        : null;
    // Counterfactual store at the same clock, with this run removed. This avoids
    // calling rediscovery of an already-stored date an incremental addition.
    const storedWithoutRun = options(
      await storedCoverageFares(
        sql,
        "TIA",
        receipt.month,
        at,
        undefined,
        receipt.run_id,
      ),
      at,
    );
    const marginal = sweepYield(storedWithoutRun, current, at);
    console.log(
      JSON.stringify({
        run: receipt.run_id,
        month: receipt.month,
        measuredAt: at,
        status: receipt.outcome,
        previousRun: prior?.run_id ?? null,
        previousStatus: prior?.outcome ?? null,
        previousMeasuredAt: previousAt,
        comparable: receipt.outcome === "stored" && prior?.outcome === "stored",
        recordedProviderPages: receipt.recorded_pages,
        actualCallCountSource:
          "collector workflow log; recorded pages exclude failed HTTP/storage attempts",
        destinations: new Set(current.map((f) => f.destination)).size,
        cityDateOptions: current.length,
        versusPreviousSweep:
          old && previousAt ? sweepYield(old, current, previousAt) : null,
        incrementalToStore: {
          addedDestinations: marginal.addedDestinations,
          addedDates: marginal.addedDates,
        },
        options: current,
      }),
    );
  }
}
main().catch(() => {
  console.error(
    "sweep yield failed: could not read requested collector evidence",
  );
  process.exitCode = 1;
});
