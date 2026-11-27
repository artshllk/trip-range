import type { MetadataRoute } from "next";
import { evidenceMode } from "@/providers/server/environment";
import { seoSitemap } from "@/seo/publication";
import { getDestinationGuides } from "@/services/destination-guides";
import { destinationSitemap, latestReviewDate } from "@/seo/destinations";
import { siteUrl } from "@/seo/registry";
/**
 * Stored decisions and reviewed snapshots only: no provider or store calls.
 * Regenerated with the guides so an expired guide leaves the sitemap too.
 */
export const revalidate = 300;
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const guides = await getDestinationGuides();
  return [
    ...seoSitemap(),
    ...(evidenceMode() === "accepted"
      ? [
          { url: siteUrl + "/data" },
          { url: siteUrl + "/data/municipal-hotel-scaling/2025-v1" },
          { url: siteUrl + "/data/fare-coverage/2026-11-05-v1" },
        ]
      : []),
    ...destinationSitemap(
      guides.map((guide) => ({
        card: guide.card,
        reviewedOn:
          guide.result.status === "reviewed"
            ? latestReviewDate(guide.result.content)
            : undefined,
      })),
    ),
    { url: `${siteUrl}/methodology` },
    { url: `${siteUrl}/about` },
  ];
}
