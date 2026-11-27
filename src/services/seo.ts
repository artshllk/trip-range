import { brand, brandOpenGraph, brandTwitter } from "../config/brand";
import type { Metadata } from "next";
import { type ActiveLocale, type Locale } from "../i18n/config";
import { absoluteUrl, languageAlternates } from "../seo/registry";
export { siteUrl, homePaths } from "../seo/registry";
export { seoSitemap as sitemapEntries } from "../seo/publication";

/** The one title separator used across every page type. */
export const titleSeparator = " — ";
export function brandedTitle(title: string) {
  return `${title}${titleSeparator}${brand.name}`;
}

export function pageMetadata(
  locale: ActiveLocale,
  title: string | { absolute: string },
  description: string,
  paths: { en: string } & Partial<Record<Locale, string>>,
  index = true,
): Metadata {
  const fullTitle =
    typeof title === "string" ? brandedTitle(title) : title.absolute;
  const shortTitle = typeof title === "string" ? title : title.absolute;
  return {
    title: fullTitle,
    description,
    alternates: {
      canonical: absoluteUrl(paths[locale]),
      languages: languageAlternates(absoluteUrl(paths[locale])),
    },
    robots: { index, follow: true },
    twitter: { ...brandTwitter, title: shortTitle, description },
    openGraph: {
      ...brandOpenGraph,
      title: shortTitle,
      description,
      locale: "en_GB",
      url: absoluteUrl(paths[locale]),
    },
  };
}
