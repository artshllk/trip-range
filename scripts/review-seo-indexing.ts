import { readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { neon } from "@neondatabase/serverless";
import { seoLandingRegistry, launchHubIds } from "../src/seo/registry";
import { editorialQuality } from "../src/seo/policy";
import { departureCode } from "../src/domain/airports";
import { flightDestinations } from "../src/catalogue/flight-destinations";
import { isInactiveDestinationId } from "../src/domain/destination-lifecycle";
import { readHubEvidence } from "../src/seo/evidence-store";
import {
  gateReviewProblems,
  hubEvidenceSummary,
  validDecision,
  type GateReview,
  type IndexingDecision,
} from "../src/seo/indexing";

/**
 * Review-time evidence for indexing decisions. Reads the fare store only
 * (read-only, repeatable read); never calls a fare provider. Prints stored-fare
 * context for each hub; writes nothing unless `--record` is given explicitly.
 * An index decision also needs a G1–G4 review file (docs/seo/indexing-gate.md):
 *
 *   npm run review:seo-indexing
 *   npm run review:seo-indexing -- --record en-tirana-origin --decision noindex --basis "..."
 *   npm run review:seo-indexing -- --record en-tirana-origin --decision index --gate review.json
 */
const DECISIONS = "src/seo/indexing-decisions.json";
const REVIEW_DAYS = 90;
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
async function main() {
  const env = {
    ...parseEnv(await readFile(".env.local", "utf8").catch(() => "")),
    ...process.env,
  };
  if (!env.DATABASE_URL)
    throw Error("DATABASE_URL is required to read stored evidence");
  const sql = neon(env.DATABASE_URL);
  const snapshotAt = new Date().toISOString();
  const priceable = new Set(
    flightDestinations
      .filter((d) => !isInactiveDestinationId(d.id))
      .flatMap((d) => (d.cityCode ? [d.cityCode] : [])),
  );

  console.log(
    `Stored-evidence review at ${snapshotAt} (fare store, read-only)\n`,
  );
  const hubs = new Map<string, Awaited<ReturnType<typeof readHubEvidence>>>();
  for (const id of launchHubIds) {
    const page = seoLandingRegistry.find((p) => p.id === id)!;
    const code = departureCode(page.origin)!;
    const evidence = await readHubEvidence(sql, code, priceable, snapshotAt);
    hubs.set(id, evidence);
    console.log(
      JSON.stringify({
        page: page.path,
        ...hubEvidenceSummary(evidence),
        destinations: evidence.qualifyingDestinations,
        editorial: editorialQuality(page).reasons.filter(
          (r) => r !== "editorially valid",
        ),
        gate: "index needs a recorded G1–G4 review (docs/seo/indexing-gate.md)",
      }),
    );
  }

  const record = arg("--record");
  if (!record) return;
  const decision = arg("--decision");
  if (decision !== "index" && decision !== "noindex")
    throw Error("--decision index|noindex is required with --record");
  const evidence = hubs.get(record);
  if (!evidence) throw Error(`No stored-evidence review for ${record}`);
  const reviewedOn = snapshotAt.slice(0, 10);
  const gateFile = arg("--gate");
  const gate: GateReview | undefined = gateFile
    ? JSON.parse(await readFile(gateFile, "utf8"))
    : undefined;
  const reviewBy = new Date(Date.parse(snapshotAt) + REVIEW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const entry: IndexingDecision = {
    pageId: record as IndexingDecision["pageId"],
    decision,
    reviewedOn,
    reviewBy,
    basis:
      arg("--basis") ??
      `${evidence.qualifyingDestinations.length} destinations with a current stored return fare from ${evidence.originCode}.`,
    ...(gate ? { gate } : {}),
    evidence,
  };
  if (!validDecision(entry))
    throw Error(
      `Refusing to record: ${JSON.stringify(decision === "index" ? gateReviewProblems(gate, reviewedOn) : ["invalid record"])}`,
    );
  const file = JSON.parse(await readFile(DECISIONS, "utf8"));
  file.decisions = [
    ...file.decisions.filter((d: IndexingDecision) => d.pageId !== record),
    entry,
  ];
  await writeFile(DECISIONS, JSON.stringify(file, null, 2) + "\n");
  console.log(`\nRecorded ${decision} for ${record} (review by ${reviewBy}).`);
}
main().catch((error: Error) => {
  console.error(`SEO indexing review failed: ${error.message}`);
  process.exitCode = 1;
});
