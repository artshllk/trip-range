import { brand, brandOpenGraph, brandTwitter } from "../config/brand";
import type { Metadata } from "next";
import {
  coreSeoRegistry,
  seoLandingRegistry,
  landingById,
  canonicalFor,
  languageAlternates,
  absoluteUrl,
  siteUrl,
  type SeoLandingDefinition,
  type SeoPageId,
} from "./registry";
import { seoQuality } from "./policy";
import { storedDecision, type IndexingDecision } from "./indexing";
import { evaluateSeoTrips, seoRequest } from "./summary";
import type { SeoDataset } from "./data";
export function landingModel(
  page: SeoLandingDefinition,
  data: SeoDataset,
  today: string,
  now: string,
) {
  const request = seoRequest(page, today);
  let evaluated;
  let state = data.state;
  try {
    evaluated = evaluateSeoTrips(data.search, request, now);
  } catch {
    state = "invalid-calculation";
    evaluated = evaluateSeoTrips({ templates: [], issues: [] }, request, now);
  }
  return {
    page,
    request,
    today,
    state,
    ...evaluated,
    // Static: the live data state shapes the page copy, never robots.
    quality: seoQuality(page),
  };
}
export type SeoLandingModel = ReturnType<typeof landingModel>;
export function landingMetadata(
  page: SeoLandingDefinition,
  hasQuery = false,
): Metadata {
  const quality = seoQuality(page);
  return {
    title: page.title,
    description: page.description,
    alternates: {
      canonical: canonicalFor(page),
      languages: languageAlternates(canonicalFor(page)),
    },
    robots: { index: quality.indexable && !hasQuery, follow: true },
    twitter: {
      ...brandTwitter,
      title: page.title,
      description: page.description,
    },
    openGraph: {
      ...brandOpenGraph,
      title: page.title,
      description: page.description,
      url: canonicalFor(page),
      locale: "en_GB",
      type: "website",
    },
  };
}
/**
 * Stored decisions only: no provider, store or request state. `lastModified`
 * is the editorial review date, never render or deployment time.
 */
export function seoSitemap(
  decisions?: readonly IndexingDecision[],
  registry: readonly SeoLandingDefinition[] = seoLandingRegistry,
) {
  const homes = coreSeoRegistry
    .filter((p) => p.indexable)
    .map((p) => ({ url: absoluteUrl(p.paths.en) }));
  const landings = registry.flatMap((page) => {
    const decision = storedDecision(page.id, decisions);
    return seoQuality(page, registry, decisions).indexable && decision
      ? [{ url: canonicalFor(page), lastModified: decision.reviewedOn }]
      : [];
  });
  return [...homes, ...landings];
}
export function breadcrumbs(page: SeoLandingDefinition) {
  const ancestors: SeoLandingDefinition[] = [];
  let current: SeoLandingDefinition | undefined = page;
  const seen = new Set<SeoPageId>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    ancestors.unshift(current);
    current = current.parent ? landingById(current.parent) : undefined;
  }
  return [
    { name: brand.name, url: absoluteUrl("/") },
    ...ancestors.map((p) => ({ name: p.breadcrumb, url: canonicalFor(p) })),
  ];
}
export function breadcrumbSchema(page: SeoLandingDefinition) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: breadcrumbs(page).map((b, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: b.name,
      item: b.url,
    })),
  };
}
export const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: brand.name,
  logo: siteUrl + brand.logo,
  url: siteUrl,
} as const;
/** Google reads the site name from WebSite markup on the homepage. */
export const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: brand.name,
  url: absoluteUrl("/"),
} as const;
export function jsonLd(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
