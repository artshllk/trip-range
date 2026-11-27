import "@/components/travel/results-v2.css";
import { pricePlan } from "@/domain/pricing";
import { curateTripCards } from "@/domain/trip-card-ranking";
import { appExplanations } from "@/services/ai/app-explanations";
import { unsupportedPreferences } from "@/domain/ai/intent";
import { notFound, redirect } from "next/navigation";
import { customPlannerEnabled } from "@/config/features";
import { localePath } from "@/i18n/routing";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { originResolution, type Query } from "@/domain/request";
import { UnresolvedOrigin } from "@/components/travel/UnresolvedOrigin";
import { getAppTripTemplates as getTripTemplates } from "@/services/app-travel";
import { currentRequest, referenceToday } from "@/services/current-request";
import { Results } from "@/components/travel/Results";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getDictionary(locale);
  return {
    title: `${t.allTrips} — Trip Range`,
    description: t.priceNote,
    robots: { index: false, follow: true },
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
  // Custom planner switched off (src/config/features.ts): old links land on /plan.
  if (!customPlannerEnabled) redirect(localePath(locale, "/plan"));
  const query = await searchParams;
  const r = await currentRequest(query);
  if (!["selected", "catalogue"].includes(originResolution(query)))
    return <UnresolvedOrigin locale={locale} />;
  const [t, search] = await Promise.all([
    getDictionary(locale),
    getTripTemplates(r),
  ]);
  const explanations = await appExplanations(
    query.ai === "1",
    curateTripCards(
      search.templates.map((b) => pricePlan(b, r)),
      r,
    ).cards,
    locale,
  );
  const unsupported =
    query.ai === "1" && typeof query.unsupported === "string"
      ? unsupportedPreferences.filter((p) =>
          String(query.unsupported).split(",").includes(p),
        )
      : [];
  return (
    <Results
      explanations={explanations}
      unsupported={unsupported}
      key={JSON.stringify(r)}
      request={r}
      today={referenceToday()}
      bases={search.templates}
      issues={search.issues}
      locale={locale}
      t={t}
    />
  );
}
