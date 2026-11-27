import "server-only";
import type { PlaceInput, PlaceIdentity } from "../../domain/media/types";
import { identityValid } from "../../domain/media/validation";
import { createMediaApi } from "../../media/adapters/api";
import {
  createWikidataIdentityResolver,
  type IdentityDiagnostic,
} from "../../places/adapters/wikidata";
import {
  reviewedIdentity,
  unresolvedIdentity,
} from "../../places/operator/identity";
import { researchWikidataAttractions } from "../adapters/wikidata";
import type { ContentResearchReport } from "./types";

/** Operator entry point only: no writes, automatic review, paid AI, or runtime imports. */
export async function researchDestinationContent(
  input: PlaceInput,
  options: { live?: boolean; reviewed?: PlaceIdentity } = {},
  fetcher: typeof fetch = fetch,
): Promise<ContentResearchReport> {
  const transport = createMediaApi(fetcher);
  const identity =
    reviewedIdentity(input, options.reviewed) ??
    unresolvedIdentity(input, "live-resolution-not-requested");
  const report: ContentResearchReport = {
    destinationId: input.subject,
    status: "offline",
    identity,
    automaticPublication: false,
    osmEnrichment: "disabled",
    candidates: [],
    sources: [],
    exclusions: [],
    truncated: false,
    requests: transport.counts,
    failures: transport.failures,
  };
  if (!identityValid(identity))
    return { ...report, status: "unavailable", reason: "invalid-input" };
  if (options.live !== true) return report;
  const diagnostics: IdentityDiagnostic[] = [];
  report.identity = await createWikidataIdentityResolver(
    transport.api,
    undefined,
    (diagnostic) => diagnostics.push(diagnostic),
  ).resolve(input, options.reviewed);
  // Legacy catalogue records may omit coordinates. Reuse the selected resolver
  // evidence; do not implement a second name/geography resolver or extra lookup.
  if (report.identity.external && !report.identity.coordinates) {
    const selected = new Map(
      diagnostics
        .filter((entry) => entry.stage === report.identity.resolutionMethod)
        .flatMap((entry) => entry.evidence)
        .map((entry) => [
          `${entry.external.authority}:${entry.external.id}`,
          entry,
        ]),
    ).get(
      `${report.identity.external.authority}:${report.identity.external.id}`,
    );
    if (
      selected?.coordinates &&
      selected.countryCode === report.identity.countryCode &&
      selected.placeKind === report.identity.placeKind
    )
      report.identity = {
        ...report.identity,
        coordinates: selected.coordinates,
      };
  }
  if (!report.identity.external || !report.identity.coordinates)
    return {
      ...report,
      status: transport.failures.length ? "unavailable" : "unresolved",
      reason: transport.failures.length
        ? "bounded-research-unavailable"
        : "identity-unresolved",
    };
  try {
    const result = await researchWikidataAttractions(
      transport.api,
      report.identity,
      new Date().toISOString(),
    );
    return { ...report, ...result, status: "complete" };
  } catch {
    return {
      ...report,
      status: "unavailable",
      reason: "bounded-research-unavailable",
    };
  }
}
