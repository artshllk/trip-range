import type { SeoPageId } from "./identity";
import decisionData from "./indexing-decisions.json";

/**
 * Indexability is an editorial decision recorded at review time, never derived
 * per request from live provider state. A provider outage during a crawl must not
 * change robots or the sitemap. Missing or invalid records fail closed to noindex.
 *
 * Gate G1–G4 (owner decision, 25 November 2026; docs/seo/indexing-gate.md): an
 * index decision must carry a recorded review showing that every shown figure is
 * sourced and every unknown named (G1), the page answers its own search question
 * (G2), it offers information the current top results lack (G3), and it can be
 * maintained (G4). The complete-basket rule and the three-destination minimum
 * are withdrawn; a stored fare count is context for a review, not the gate.
 */

/** Stored-evidence window for origin-hub fare context. */
export const hubEvidenceRule = {
  /** A fare counts only if we fetched it within this many days of the snapshot. */
  maxFetchAgeDays: 10,
} as const;

/** SERP observations older than this, relative to the review, are stale for G3. */
export const gateSerpMaxAgeDays = 30;

export type GateReview = {
  version: "g1-g4-v1";
  /** G1: counts found when the reviewer checked every figure on the page. */
  integrity: {
    checkedOn: string;
    unsourcedFigures: number;
    unnamedUnknowns: number;
  };
  /** G2: the one search question this page answers, and no other indexed page does. */
  question: string;
  /** G3: what the current top results show, and what this page adds. */
  informationGain: {
    query: string;
    serpCheckedOn: string;
    topResults: string[];
    gain: string;
  };
  /** G4: how the figures are kept current, and when the page is withdrawn. */
  maintenance: { refresh: string; withdrawWhen: string };
  reviewer: string;
};

export type HubEvidence = {
  kind: "hub-v1";
  source: "fare-store";
  snapshotAt: string;
  originCode: string;
  /** City codes with a stored return fare meeting `hubEvidenceRule`. */
  qualifyingDestinations: string[];
};

export type IndexingDecision = {
  pageId: SeoPageId;
  decision: "index" | "noindex";
  /** YYYY-MM-DD; also the page's sitemap lastmod. */
  reviewedOn: string;
  /** YYYY-MM-DD; `npm run check:seo` reports overdue reviews. Never auto-flips. */
  reviewBy: string;
  basis: string;
  /** Required for an index decision. */
  gate?: GateReview;
  /** Optional stored-fare context for an origin hub. */
  evidence?: HubEvidence;
};

const day = /^\d{4}-\d{2}-\d{2}$/;

/** Stored-fare context for a hub review. Informational: it is not the gate. */
export function hubEvidenceSummary(evidence: HubEvidence) {
  return {
    originCode: evidence.originCode,
    destinationsWithStoredFare: evidence.qualifyingDestinations.length,
  };
}

const text = (s: unknown, min: number) =>
  typeof s === "string" && s.trim().length >= min;

/** Reasons a G1–G4 review does not support an index decision; empty when it does. */
export function gateReviewProblems(
  gate: GateReview | undefined,
  reviewedOn: string,
): string[] {
  if (!gate) return ["no G1–G4 review recorded"];
  const problems: string[] = [];
  if (gate.version !== "g1-g4-v1") problems.push("unknown gate version");
  const g1 = gate.integrity;
  if (
    !g1 ||
    !day.test(g1.checkedOn) ||
    g1.checkedOn > reviewedOn ||
    g1.unsourcedFigures !== 0 ||
    g1.unnamedUnknowns !== 0
  )
    problems.push("G1: a figure is unsourced or an unknown is unnamed");
  if (!text(gate.question, 10)) problems.push("G2: no stated search question");
  const g3 = gate.informationGain;
  const serpAge =
    g3 && day.test(g3.serpCheckedOn)
      ? (Date.parse(reviewedOn) - Date.parse(g3.serpCheckedOn)) / 86_400_000
      : NaN;
  if (
    !g3 ||
    !text(g3.query, 3) ||
    !(serpAge >= 0 && serpAge <= gateSerpMaxAgeDays) ||
    !Array.isArray(g3.topResults) ||
    g3.topResults.filter((r) => text(r, 3)).length < 3 ||
    !text(g3.gain, 20)
  )
    problems.push(
      `G3: needs the query, at least three top results checked within ${gateSerpMaxAgeDays} days, and the information gained`,
    );
  if (
    !gate.maintenance ||
    !text(gate.maintenance.refresh, 10) ||
    !text(gate.maintenance.withdrawWhen, 10)
  )
    problems.push("G4: no refresh path or withdrawal condition");
  if (!text(gate.reviewer, 2)) problems.push("no reviewer");
  return problems;
}

/** Structural validity of one stored record; an invalid record is treated as absent. */
export function validDecision(record: IndexingDecision) {
  if (
    !/^en-/.test(record.pageId) ||
    !["index", "noindex"].includes(record.decision) ||
    !day.test(record.reviewedOn) ||
    !day.test(record.reviewBy) ||
    record.reviewBy <= record.reviewedOn ||
    record.basis.trim().length < 10
  )
    return false;
  if (record.decision === "noindex") return true;
  // Stored-fare context, when attached, must predate the review it informed.
  const evidence = record.evidence;
  if (
    evidence &&
    (evidence.kind !== "hub-v1" ||
      evidence.source !== "fare-store" ||
      evidence.snapshotAt.slice(0, 10) > record.reviewedOn)
  )
    return false;
  // An index decision must carry a passing G1–G4 review.
  return gateReviewProblems(record.gate, record.reviewedOn).length === 0;
}

export const indexingDecisions =
  decisionData.decisions as unknown as readonly IndexingDecision[];

export function storedDecision(
  pageId: SeoPageId,
  decisions: readonly IndexingDecision[] = indexingDecisions,
) {
  const matches = decisions.filter((d) => d.pageId === pageId);
  // Duplicates are ambiguous: fail closed.
  return matches.length === 1 && validDecision(matches[0])
    ? matches[0]
    : undefined;
}

export function overdueReviews(
  today: string,
  decisions: readonly IndexingDecision[] = indexingDecisions,
) {
  return decisions.filter((d) => d.reviewBy <= today);
}
