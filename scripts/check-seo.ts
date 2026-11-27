import { seoLandingRegistry } from "../src/seo/registry";
import { seoQuality, editorialQuality } from "../src/seo/policy";
import { seoSitemap } from "../src/seo/publication";
import { storedDecision, overdueReviews } from "../src/seo/indexing";
/**
 * Offline: no credentials, provider calls or store reads. Reports what robots
 * and the sitemap will say, which is decided only by stored review records.
 * Evidence for a new decision comes from `npm run review:seo-indexing`.
 */
function main() {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  console.log("SEO publication state (stored decisions; offline)");
  for (const page of seoLandingRegistry) {
    const decision = storedDecision(page.id);
    console.log(
      JSON.stringify({
        path: page.path,
        indexable: seoQuality(page).indexable,
        editorial: editorialQuality(page).reasons,
        decision: decision?.decision ?? "none",
        reviewedOn: decision?.reviewedOn ?? null,
        reviewBy: decision?.reviewBy ?? null,
      }),
    );
  }
  const overdue = overdueReviews(today);
  for (const d of overdue)
    console.warn(
      `Review overdue: ${d.pageId} (reviewBy ${d.reviewBy}). The decision stands until re-reviewed.`,
    );
  console.log(JSON.stringify({ sitemapUrls: seoSitemap().map((p) => p.url) }));
}
main();
