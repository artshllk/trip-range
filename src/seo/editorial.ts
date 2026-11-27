import type { SeoEditorialDefinition } from "./definition";
export function canonicalIntent(page: SeoEditorialDefinition) {
  return [
    page.locale,
    page.origin.id,
    page.type,
    page.type === "budget"
      ? `${page.budget?.currency}:${page.budget?.cents}`
      : "",
  ].join(":");
}
/** Editorial lint, not a keyword generator. Keyword arrays are never rendered or added to metadata. */
export function validEditorialIntent(page: SeoEditorialDefinition) {
  // One brand suffix, the site-wide " — " separator. Drafts may still carry
  // the legacy "| GoEksplo" form until their wording is reviewed.
  const title = page.title.replace(/(?: — Trip Range| \| GoEksplo)$/, ""),
    primary = page.keywords.primary.toLowerCase();
  return (
    title.toLowerCase() === page.h1.toLowerCase() &&
    page.title.length <= 70 &&
    page.description.length <= 180 &&
    page.intro.length >= 60 &&
    primary.length >= 8 &&
    [page.title, page.h1, page.description, page.intro].every(
      (text) => text.toLowerCase().split(primary).length <= 2,
    )
  );
}
