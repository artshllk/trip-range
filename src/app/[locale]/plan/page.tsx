import { MonthPlanner } from "@/components/discovery/MonthPlanner";
import { isMonthDiscovery } from "@/domain/month-discovery";
import { boundedSearchQuery } from "@/domain/request-limits";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { originResolution, type Query } from "@/domain/request";
import { UnresolvedOrigin } from "@/components/travel/UnresolvedOrigin";
import { currentRequest, referenceToday } from "@/services/current-request";
import { SearchBar } from "@/components/travel/SearchBar";
import { localePath } from "@/i18n/routing";
import { customPlannerEnabled } from "@/config/features";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getDictionary(locale);
  return {
    title: `${t.planner} — Trip Range`,
    description: t.priceNote,
    // Every ?depart=, ?month= or ?ceiling= view is the same noindex page.
    robots: { index: false, follow: true },
    alternates: { canonical: localePath(locale, "/plan") },
  };
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Query>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  if (!boundedSearchQuery(query)) notFound();
  if (isMonthDiscovery(query)) return <MonthPlanner query={query} />;
  // Custom planner switched off (src/config/features.ts): any planner query shows
  // the two-night month view, with a line saying why.
  if (!customPlannerEnabled) return <MonthPlanner query={query} plannerOff />;
  const parsed = await currentRequest(query);
  const t = await getDictionary(locale);
  // An origin we can't identify leaves the field empty rather than prefilled.
  const unresolved = originResolution(query) === "unresolved";
  const r = unresolved
    ? { ...parsed, originId: "", origin: undefined }
    : parsed;
  return (
    <main id="main" className="shell section stack">
      <h1>{t.searchHero}</h1>
      {unresolved ? <UnresolvedOrigin locale={locale} inline /> : null}
      <SearchBar
        key={JSON.stringify(r)}
        initial={r}
        locale={locale}
        t={t}
        today={referenceToday()}
      />
    </main>
  );
}
