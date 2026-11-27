import { userInput } from "../../domain/money/provenance";
import { readLocation } from "../../domain/locations";
import { marketProfile } from "../../domain/market/policy";
import { formatMoney } from "../../domain/money/currency";
import { canonicalIntent, validEditorialIntent } from "../editorial";
import { landingId, landingPath } from "../identity";
import { candidateMarkets } from "./markets";
import type { SeoCandidateDefinition } from "./registry";

/** Editorial lint has no indexing or publication side effects. */
export function validateCandidate(
  page: SeoCandidateDefinition,
  registry: readonly SeoCandidateDefinition[],
): string[] {
  const reasons: string[] = [];
  const market = candidateMarkets.find((m) => m.slug === page.key.originId);
  const origin = readLocation(page.origin);
  if (
    !market ||
    !origin ||
    origin.id !== market.origin.id ||
    origin.type !== "city" ||
    origin.cityCode !== market.origin.cityCode ||
    origin.countryCode !== market.origin.countryCode ||
    marketProfile(origin)?.originId !== market.slug
  )
    reasons.push("invalid candidate origin");
  if (
    page.locale !== "en" ||
    page.stage !== "candidate" ||
    "approved" in page ||
    "indexable" in page
  )
    reasons.push("candidate authority mismatch");
  try {
    if (
      landingId(page.key) !== page.id ||
      landingPath(page.key) !== page.path ||
      page.key.intent !== page.type
    )
      reasons.push("candidate route identity mismatch");
  } catch {
    reasons.push("invalid candidate identity");
  }
  if (
    !market ||
    page.planningCurrency !== market.budget.currency ||
    page.exampleBudget.currency !== market.budget.currency ||
    page.exampleBudget.cents !== market.budget.cents ||
    (page.type === "budget" &&
      (page.budget?.cents !== market.budget.cents ||
        page.budget?.currency !== market.budget.currency ||
        page.key.intent !== "budget" ||
        page.key.budget.cents !== market.budget.cents ||
        page.key.budget.currency !== market.budget.currency)) ||
    (page.type !== "budget" && page.budget !== undefined)
  )
    reasons.push("candidate budget policy mismatch");
  if (
    page.type === "budget" &&
    market &&
    ![page.title, page.h1, page.intro].every((s) =>
      s.includes(formatMoney(userInput(market.budget), "en")),
    )
  )
    reasons.push("whole-party budget intent missing");
  if (!validEditorialIntent(page))
    reasons.push("editorial intent needs review");
  for (const [label, key] of [
    ["title", (p: SeoCandidateDefinition) => p.title.toLowerCase()],
    ["H1", (p: SeoCandidateDefinition) => p.h1.toLowerCase()],
    ["canonical intent", canonicalIntent],
    ["path", (p: SeoCandidateDefinition) => p.path],
  ] as const) {
    if (registry.filter((p) => key(p) === key(page)).length !== 1)
      reasons.push(`duplicate ${label}`);
  }
  const family = registry.filter((p) => p.key.originId === page.key.originId);
  if (family.length !== 3 || new Set(family.map((p) => p.type)).size !== 3)
    reasons.push("candidate family requires one of each intent");
  const parent = family.find(
    (p) => p.type === (page.type === "weekend" ? "origin" : "weekend"),
  );
  const expectedRelated = family
    .filter((p) => p.id !== page.id)
    .map((p) => p.id)
    .sort();
  if (
    (page.type === "origin"
      ? page.parent !== undefined
      : page.parent !== parent?.id) ||
    JSON.stringify([...page.related].sort()) !== JSON.stringify(expectedRelated)
  )
    reasons.push("invalid draft relationships");
  if (
    new Set(page.sections).size < 6 ||
    !["results", "dates", "methodology", "questions", "related"].every((s) =>
      page.sections.some((p) => p === s),
    ) ||
    page.questions.length < 2 ||
    page.questions.some(
      (q) => q.question.length < 15 || q.answer.length < 50,
    ) ||
    new Set(page.questions.map((q) => q.question)).size !==
      page.questions.length
  )
    reasons.push("incomplete candidate sections");
  if (
    page.dateContract.kind !== "month-weekends" ||
    page.dateContract.monthPolicy !== "next-full-month" ||
    !page.intro.includes("Saturday–Monday") ||
    !page.intro.includes("displayed month") ||
    !page.intro.includes("actual dates") ||
    !page.intro.includes("different weekends")
  )
    reasons.push("monthly date contract copy mismatch");
  if (
    /for this weekend|exact dates stay exact|guaranteed availability|no annual leave needed|best flights|cheapest flights|direct-flight/i.test(
      [page.title, page.h1, page.description, page.intro].join(" "),
    )
  )
    reasons.push("unsupported editorial claim");
  if (
    market?.slug === "chicago" &&
    ![page.title, page.h1, page.intro].every((s) => /plane|flight/i.test(s))
  )
    reasons.push("Chicago requires flight-qualified intent");
  return [...new Set(reasons)];
}
