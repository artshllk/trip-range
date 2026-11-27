import type { MetadataRoute } from "next";
import { siteUrl } from "../seo/registry";
/**
 * Planner results and trip pages call flight providers on every request and
 * share one provider quota with real visitors. They have never been indexed,
 * so blocking the crawl is safe; noindex alone would still let a crawler spend
 * the quota and lock visitors out of search. `/plan` itself makes no
 * provider call and stays crawlable (noindex).
 */
export const disallowedPaths = ["/api/", "/plan/"] as const;
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: [...disallowedPaths] },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
