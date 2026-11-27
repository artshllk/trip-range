/** Offline only: local reviewed profiles, safe candidate history and a bounded research selection. */
import { readFile, readdir } from "node:fs/promises";
import { referenceCalendarDate, isCalendarDate } from "../src/domain/dates";
import {
  activeCostProfile,
  completeCostProfile,
  validateCostProfiles,
  destinationCostComponents,
} from "../src/domain/costs/policy";
import type { DestinationCostComponent } from "../src/domain/costs/types";
import { destinationCostProfiles } from "../src/domain/costs/profiles";
import { candidateCostCoverage } from "../src/seo/candidates/cost-coverage";
import { readCandidateEvidence } from "../src/seo/candidates/evidence";
import { candidateMarkets } from "../src/seo/candidates/markets";
import { flightDestinations } from "../src/catalogue/flight-destinations";
type Selection = {
  origin: string;
  currency: string;
  destinations: { id: string; fits: boolean }[];
};
type BasketReview = {
  records: {
    destinationId: string;
    currency: string;
    origin: string;
    status: "FULL" | "PARTIAL" | "DEFERRED";
    components: {
      component: DestinationCostComponent;
      blocker: string | null;
    }[];
  }[];
};
export async function checkCostProfiles(today: string) {
  if (!isCalendarDate(today)) throw Error("Invalid reference date");
  validateCostProfiles(destinationCostProfiles);
  const directory = "docs/seo/evidence/candidates";
  const files = (await readdir(directory))
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  const history = (
    await Promise.all(
      files.map(
        async (file) =>
          readCandidateEvidence(
            JSON.parse(await readFile(`${directory}/${file}`, "utf8")),
          ).observations,
      ),
    )
  ).flat();
  const selection: { origins: Selection[] } = JSON.parse(
    await readFile("docs/seo/evidence/costs/selection-2026-10-08.json", "utf8"),
  );
  const active = destinationCostProfiles.filter(
    (p) => !!activeCostProfile(p.destinationId, p.currency, today),
  );
  const research: BasketReview = JSON.parse(
    await readFile(
      "docs/seo/evidence/costs/tier-a-baskets-2026-10-08-v2.json",
      "utf8",
    ),
  );
  return {
    mode: "offline",
    asOf: today,
    selectedPairCount: selection.origins.reduce(
      (count, origin) => count + origin.destinations.length,
      0,
    ),
    activeReviewedProfileCount: active.length,
    fullReviewedProfileCount: active.filter(completeCostProfile).length,
    partialReviewedProfileCount: active.filter((p) => !completeCostProfile(p))
      .length,
    destinationCount: new Set(active.map((p) => p.destinationId)).size,
    currencies: [...new Set(active.map((p) => p.currency))].sort(),
    staleProfileCount: destinationCostProfiles.filter(
      (p) => today >= p.reviewAfter,
    ).length,
    candidates: candidateMarkets.map((m) => {
      const latest = history
        .filter((o) => o.origin === m.slug)
        .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
      const coverage = latest
        ? candidateCostCoverage(latest, today)
        : undefined;
      const selected = selection.origins.find(
        (o) => o.origin === m.slug && o.currency === m.budget.currency,
      )!;
      if (!selected || !Array.isArray(selected.destinations))
        throw Error("Invalid cost research selection");
      const destinations = selected.destinations.map((d) => {
        const id = /^city:[A-Z]{3}$/.test(d.id)
          ? d.id
          : `city:${flightDestinations.find((f) => f.id === d.id)?.iataCodes?.[0]}`;
        if (!/^city:[A-Z]{3}$/.test(id) || typeof d.fits !== "boolean")
          throw Error("Invalid research identity");
        const profile = activeCostProfile(id, m.budget.currency, today);
        const stored = destinationCostProfiles.find(
          (p) => p.destinationId === id && p.currency === m.budget.currency,
        );
        const review = research.records.find(
          (r) =>
            r.destinationId === id &&
            r.currency === m.budget.currency &&
            r.origin === m.slug,
        );
        if (!review) throw Error("Missing selected pair review");
        const missingComponents = destinationCostComponents.filter(
          (c) => !profile?.costs[c],
        );
        const stale = !!stored && today >= stored.reviewAfter;
        return {
          id,
          currency: m.budget.currency,
          originallyFit: d.fits,
          researchStatus: review.status,
          stale,
          missingComponents,
          blockers: [
            ...new Set([
              ...(stale ? ["profile-expired"] : []),
              ...missingComponents.flatMap((component) => {
                const blocker = review.components.find(
                  (c) => c.component === component,
                )?.blocker;
                return blocker && /^[a-z-]{1,80}$/.test(blocker)
                  ? [blocker]
                  : [];
              }),
            ]),
          ],
          costCoverage: completeCostProfile(profile)
            ? "full"
            : profile
              ? "partial"
              : "generic",
        };
      });
      return {
        origin: m.slug,
        currency: m.budget.currency,
        latestObservationCostCoverage: coverage?.available
          ? "available"
          : "unavailable-identities-not-recorded",
        latestReviewedComplete: coverage?.available ? coverage.complete : null,
        latestReviewedFits: coverage?.available ? coverage.fits : null,
        researchSelectionOnly: {
          checkedOn: "2026-10-08",
          isLongitudinalObservation: false,
          completeDestinations: destinations.length,
          originallyFitDestinations: destinations.filter((d) => d.originallyFit)
            .length,
          fullReviewedComplete: destinations.filter(
            (d) => d.costCoverage === "full",
          ).length,
          fullReviewedOriginallyFit: destinations.filter(
            (d) => d.originallyFit && d.costCoverage === "full",
          ).length,
          fullReviewedOriginallyFitIds: destinations
            .filter((d) => d.originallyFit && d.costCoverage === "full")
            .map((d) => d.id),
          partialProfiles: destinations.filter(
            (d) => d.costCoverage === "partial",
          ).length,
          genericPairs: destinations.filter((d) => d.costCoverage === "generic")
            .length,
          staleProfiles: destinations.filter((d) => d.stale).length,
          missingFullProfiles: destinations
            .filter((d) => d.costCoverage !== "full")
            .map((d) => d.id),
          destinations,
        },
      };
    }),
  };
}
if (require.main === module)
  void (async () => {
    if (process.argv.length !== 2)
      throw Error("Offline command accepts no options");
    console.log(
      JSON.stringify(
        await checkCostProfiles(referenceCalendarDate(new Date())),
        null,
        2,
      ),
    );
  })().catch(() => {
    console.log(
      JSON.stringify({ status: "cost-profile-diagnostic-unavailable" }),
    );
    process.exitCode = 1;
  });
