import { reportDiagnostic } from "../server/observability";
import { departureCode } from "../domain/airports";
import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createHash } from "node:crypto";
import { serverEnvironment } from "../providers/server/environment";
import { referenceToday } from "../services/current-request";
import { allowOperation } from "../server/rate-limit";
import { loadSeoSearch, type SeoDataset } from "./data";
import { landingById, seoLandingRegistry, type SeoPageId } from "./registry";
import { seoRequest } from "./summary";
import { landingModel } from "./publication";
export const SEO_CACHE_SECONDS = 900;
// Fixed approved origins only. Deduplicate cold metadata/page/sitemap requests in this process;
// Next Data Cache shares successful and safe unavailable snapshots across instances.
const pending = new Map<string, Promise<SeoDataset>>();
const dataset = cache(async (originId: string) => {
  const definition = seoLandingRegistry.find(
    (page) =>
      page.approved && page.origin.id === originId && page.type === "origin",
  );
  if (!definition) throw new Error("Unapproved SEO origin");
  const env = serverEnvironment();
  const today = referenceToday();
  const request = seoRequest(definition, today);
  const configuration = {
    TRAVELPAYOUTS_API_TOKEN: env.travelpayouts.TRAVELPAYOUTS_API_TOKEN,
    PEXELS_API_KEY: env.pexelsKey,
  };
  const identity = createHash("sha256")
    .update(
      JSON.stringify([
        configuration,
        request,
        Math.floor(Date.now() / (SEO_CACHE_SECONDS * 1000)),
      ]),
    )
    .digest("hex");
  if (!pending.has(identity)) {
    const value = unstable_cache(
      () =>
        loadSeoSearch(
          request,
          configuration,
          fetch,
          () => allowOperation("search"),
          undefined,
          true,
        ),
      ["seo-origin-evidence-v3-pricing-integrity", identity],
      { revalidate: SEO_CACHE_SECONDS },
    )();
    // At most four in-flight generations (normal bound: current and previous time bucket).
    if (pending.size >= 4) pending.delete(pending.keys().next().value!);
    pending.set(identity, value);
    void value.finally(() => pending.delete(identity)).catch(() => {});
  }
  try {
    return { data: await pending.get(identity)!, today };
  } catch {
    return {
      data: {
        search: { templates: [], issues: [] },
        state: "provider",
      } as SeoDataset,
      today,
    };
  }
});
/** Same evidence snapshot for page, metadata and sitemap. No query data enters its cache key. */
export const getLandingModel = cache(async (id: SeoPageId) => {
  const page = landingById(id);
  if (!page) return undefined;
  const { data, today } = await dataset(page.origin.id);
  const model = landingModel(page, data, today, new Date().toISOString());
  reportDiagnostic({
    level: "debug",
    component: "seo",
    operation: "seo-quality",
    status: model.quality.indexable ? "indexable" : "noindex",
    originCode: departureCode(page.origin),
    currency: page.planningCurrency,
    count: model.summary.providerSupportedCount,
  });
  return model;
});
export async function getSeoPublications() {
  return (
    await Promise.all(
      seoLandingRegistry
        .filter((p) => p.approved)
        .map((p) => getLandingModel(p.id)),
    )
  ).filter((p) => p !== undefined);
}
