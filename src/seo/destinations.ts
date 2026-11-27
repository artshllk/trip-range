import { brand, brandOpenGraph, brandTwitter } from "../config/brand";
import type { Metadata } from "next";
import type { DestinationCard } from "../domain/destination-discovery";
import { siteUrl, languageAlternates } from "./registry";

const separator = " — ";
/**
 * Owner decision, 25 November 2026 (docs/seo/indexing-gate.md): the guides fail G3.
 * They are sourced and dated, but offer nothing the established results for
 * "<city> travel guide" lack. They stay published and linked, noindex and out of
 * the sitemap, until a review records a passing G1–G4 for a guide.
 */
export const guidesIndexable = false;
/**
 * Written meta descriptions, one per published guide. They describe what the
 * guide covers and name only places the guide contains; never truncated
 * overview text. Tests require one for every collection slug.
 */
export const guideDescriptions: Record<string, string> = {
  vienna:
    "Plan a short Vienna trip: the old centre, Schönbrunn as its own outing, where to stay from the Innere Stadt to Leopoldstadt, and how to get around.",
  london:
    "Plan a short London trip by area: Westminster with the South Bank, the Tower on another day, where to stay, and which airport you actually land at.",
  paris:
    "Plan a short Paris trip: the Eiffel Tower, the Louvre, Notre-Dame and Montmartre, grouped by area so a weekend isn’t spent crossing the city.",
  istanbul:
    "Plan a short Istanbul trip around the historic peninsula: Hagia Sophia, Topkapı Palace and the Basilica Cistern, where to stay, and the airport link.",
  barcelona:
    "Plan a short Barcelona trip by neighbourhood: Gaudí in the Eixample, the Gothic Quarter and the art museums, and which interiors to choose first.",
};
export function guideDescription(card: DestinationCard) {
  return guideDescriptions[card.slug] ?? card.description;
}
export function guideUrl(card: DestinationCard) {
  return `${siteUrl}/destinations/${card.slug}`;
}
export function destinationMetadata(card: DestinationCard): Metadata {
  const url = guideUrl(card);
  const description = guideDescription(card);
  const social = `${card.name}${separator}${brand.name}`;
  return {
    title: `${card.name}: a practical travel guide${separator}${brand.name}`,
    description,
    alternates: { canonical: url, languages: languageAlternates(url) },
    robots: { index: guidesIndexable, follow: true },
    twitter: { ...brandTwitter, title: social, description },
    openGraph: {
      ...brandOpenGraph,
      title: social,
      description,
      url,
      locale: "en_GB",
      type: "website",
    },
  };
}
/** Matches the visible breadcrumb on the guide page exactly. */
export function guideBreadcrumbSchema(card: DestinationCard) {
  const crumbs = [
    { name: brand.name, url: siteUrl },
    { name: "Destinations", url: `${siteUrl}/destinations` },
    { name: card.name, url: guideUrl(card) },
  ];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: c.url,
    })),
  };
}
/** Latest editorial review date among the content the guide currently publishes. */
export function latestReviewDate(content: unknown): string | undefined {
  let latest: string | undefined;
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (
        key === "reviewedAt" &&
        typeof child === "string" &&
        Number.isFinite(Date.parse(child))
      ) {
        const date = new Date(child).toISOString().slice(0, 10);
        if (!latest || date > latest) latest = date;
      } else visit(child);
    }
  };
  visit(content);
  return latest;
}
export function destinationSitemap(
  guides: readonly { card: DestinationCard; reviewedOn?: string }[],
) {
  if (!guidesIndexable || !guides.length) return [];
  const dates = guides.flatMap((g) => (g.reviewedOn ? [g.reviewedOn] : []));
  const index = dates.length ? dates.sort()[dates.length - 1] : undefined;
  return [
    {
      url: `${siteUrl}/destinations`,
      ...(index ? { lastModified: index } : {}),
    },
    ...guides.map((g) => ({
      url: guideUrl(g.card),
      ...(g.reviewedOn ? { lastModified: g.reviewedOn } : {}),
    })),
  ];
}
