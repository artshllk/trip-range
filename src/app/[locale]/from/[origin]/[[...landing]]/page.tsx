import { MonthPlanner } from "@/components/discovery/MonthPlanner";
import { primaryOriginId } from "@/domain/market/primary-origin";
import { planOrigins } from "@/domain/plan-origins";
import { customPlannerEnabled } from "@/config/features";
import { boundedSearchQuery } from "@/domain/request-limits";
import { notFound } from "next/navigation";
import { localePath } from "@/i18n/routing";
import { approvedLanding } from "@/seo/registry";
import { getLandingModel } from "@/seo/server";
import { landingMetadata } from "@/seo/publication";
import { getDictionary } from "@/i18n/dictionaries";
import { SeoLanding } from "@/components/seo/SeoLanding";
import type { Query } from "@/domain/request";
type Props = {
  params: Promise<{ locale: string; origin: string; landing?: string[] }>;
  searchParams: Promise<Query>;
};
async function definition(params: Props["params"]) {
  const { locale, origin, landing = [] } = await params;
  if (locale !== "en" || landing.length > 1) notFound();
  const page = approvedLanding(
    localePath(
      locale,
      `/from/${origin}${landing.length ? `/${landing[0]}` : ""}`,
    ),
  );
  if (!page) notFound();
  // Other origins' landings are built from the custom planner, which is switched
  // off (src/config/features.ts); /from/tirana is the month planner and stays.
  if (!customPlannerEnabled && page.origin.id !== primaryOriginId) notFound();
  return page;
}
/** Metadata reads the stored decision only; it never waits on a provider. */
export async function generateMetadata({ params, searchParams }: Props) {
  const page = await definition(params);
  return landingMetadata(page, Object.keys(await searchParams).length > 0);
}
export default async function Page({ params, searchParams }: Props) {
  const page = await definition(params);
  if (page.origin.id === primaryOriginId) {
    const query = await searchParams;
    if (!boundedSearchQuery(query)) notFound();
    // The path names the origin; a ?depart= in the query cannot change it, and a
    // later change of /plan's default origin does not move this page.
    const fixed = planOrigins.find((o) => o.slug === page.origin.id);
    if (!fixed) notFound();
    return (
      <MonthPlanner
        query={query}
        questions={page.questions}
        fixedOrigin={fixed}
      />
    );
  }
  const [model, t] = await Promise.all([
    getLandingModel(page.id),
    getDictionary("en"),
  ]);
  if (!model) notFound();
  return <SeoLanding model={model} t={t} />;
}
