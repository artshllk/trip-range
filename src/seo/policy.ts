import { userInput } from "../domain/money/provenance";
import { isCurrency, majorUnits, formatMoney } from "../domain/money/currency";
import { publicationCurrency, marketProfile } from "../domain/market/policy";
import { landingId, landingPath } from "./identity";
import { approvedLandingKeys } from "./approved-keys";
import { readLocation } from "../domain/locations";
import { departureCode } from "../domain/airports";
import { seoLandingRegistry, type SeoLandingDefinition } from "./registry";
export type SeoQualityResult = { indexable: boolean; reasons: string[] };
/** Live data state: drives the page's honest copy only, never robots or sitemap. */
export type SeoDataState =
  | "ready"
  | "configuration"
  | "provider"
  | "timeout"
  | "rate-limit"
  | "invalid-calculation";
export { canonicalIntent, validEditorialIntent } from "./editorial";
import { canonicalIntent, validEditorialIntent } from "./editorial";
import { storedDecision, type IndexingDecision } from "./indexing";
/**
 * Static editorial checks only. Nothing here reads provider, store or request
 * state, so robots and the sitemap cannot change with a provider outage.
 */
export function editorialQuality(
  page: SeoLandingDefinition,
  registry: readonly SeoLandingDefinition[] = seoLandingRegistry,
): SeoQualityResult {
  const reasons: string[] = [];
  const approved = registry.find(
    (p) => p.id === page.id && p.path === page.path && p.approved,
  );
  if (
    !approved ||
    !page.approved ||
    !approvedLandingKeys.some((key) => landingId(key) === page.id)
  )
    reasons.push("not approved for publication");
  if (
    page.locale !== "en" ||
    !/^\/from\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\/weekend-trips(?:-under-[1-9]\d*)?)?$/.test(
      page.path,
    )
  )
    reasons.push("outside English publication policy");
  try {
    if (
      landingId(page.key) !== page.id ||
      landingPath(page.key) !== page.path ||
      page.key.intent !== page.type ||
      page.key.originId !==
        (marketProfile(page.origin)?.originId ?? page.origin.id)
    )
      reasons.push("publication identity mismatch");
  } catch {
    reasons.push("invalid publication identity");
  }
  if (
    !isCurrency(page.planningCurrency) ||
    page.planningCurrency !== publicationCurrency(page.origin) ||
    page.exampleBudget.currency !== page.planningCurrency
  )
    reasons.push("publication currency policy mismatch");
  const origin = readLocation(page.origin);
  if (
    !origin ||
    origin.type === "country" ||
    !departureCode(origin) ||
    // "/from/{origin}...": segment 2 is the origin (English is unprefixed).
    page.path.split("/")[2] !== (marketProfile(origin)?.originId ?? origin.id)
  )
    reasons.push("invalid normalized origin");
  if (
    (page.type === "origin" && page.path.split("/").length !== 3) ||
    (page.type === "weekend" && !page.path.endsWith("/weekend-trips")) ||
    (page.type !== "budget" && page.budget !== undefined)
  )
    reasons.push("path and page intent mismatch");
  if (
    page.type === "budget" &&
    (!page.budget ||
      !isCurrency(page.budget.currency) ||
      page.budget.currency !== page.planningCurrency ||
      page.key.intent !== "budget" ||
      page.key.budget.currency !== page.budget.currency ||
      page.key.budget.cents !== page.budget.cents ||
      !Number.isSafeInteger(page.budget.cents) ||
      page.budget.cents <= 0 ||
      !page.path.endsWith(`-under-${majorUnits(page.budget)}`))
  )
    reasons.push("invalid budget intent");
  if (
    page.type === "budget" &&
    page.budget &&
    isCurrency(page.budget.currency) &&
    Number.isSafeInteger(page.budget.cents) &&
    ![page.title, page.h1, page.intro].every((text) =>
      text.includes(formatMoney(userInput(page.budget!), "en")),
    )
  )
    reasons.push("budget currency missing from editorial intent");
  if (
    registry.filter(
      (p) =>
        p.approved &&
        (p.path === page.path ||
          canonicalIntent(p) === canonicalIntent(page) ||
          p.h1.toLowerCase() === page.h1.toLowerCase()),
    ).length !== 1
  )
    reasons.push("duplicate canonical intent");
  if (!validEditorialIntent(page))
    reasons.push("editorial intent needs review");
  if (
    new Set(page.sections).size < 5 ||
    !["results", "methodology", "questions", "related"].every((s) =>
      page.sections.includes(s as (typeof page.sections)[number]),
    ) ||
    page.questions.length < 2
  )
    reasons.push("incomplete content sections");
  return {
    indexable: reasons.length === 0,
    reasons: reasons.length ? reasons : ["editorially valid"],
  };
}
/** Robots and sitemap: static editorial checks plus the stored review decision. */
export function seoQuality(
  page: SeoLandingDefinition,
  registry: readonly SeoLandingDefinition[] = seoLandingRegistry,
  decisions?: readonly IndexingDecision[],
): SeoQualityResult {
  const editorial = editorialQuality(page, registry);
  const decision = storedDecision(page.id, decisions);
  const reasons = editorial.indexable ? [] : [...editorial.reasons];
  if (!decision) reasons.push("no valid stored indexing decision");
  else if (decision.decision !== "index")
    reasons.push(`stored decision noindex (${decision.reviewedOn})`);
  return {
    indexable: reasons.length === 0,
    reasons: reasons.length
      ? reasons
      : [`indexed by review on ${decision!.reviewedOn}`],
  };
}
