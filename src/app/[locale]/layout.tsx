import { brand, brandOpenGraph, brandTwitter } from "@/config/brand";
import { AiFeature } from "@/components/layout/AiFeature";
import { PrivateAnalytics } from "@/components/layout/PrivateAnalytics";
import { serverEnvironment } from "@/providers/server/environment";
import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist } from "next/font/google";
import { notFound } from "next/navigation";
import { isLocale, locales } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { SearchPreferences } from "@/components/layout/SearchPreferences";
import { siteUrl } from "@/seo/registry";
import "../globals.css";
// Covers bounded discovery, metadata, imagery and one optional explanation batch.
export const maxDuration = 60;
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});
const sans = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: brand.name,
  publisher: brand.name,
  appleWebApp: { title: brand.name },
  openGraph: { ...brandOpenGraph, title: brand.name },
  twitter: { ...brandTwitter, title: brand.name },
};
export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}
export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getDictionary(locale);
  const environment = serverEnvironment();
  return (
    <html
      lang={locale}
      data-scroll-behavior="smooth"
      className={`${display.variable} ${sans.variable}`}
    >
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <PrivateAnalytics enabled={environment.vercelAnalytics}>
          <AiFeature enabled={environment.ai.enabled}>
            <SearchPreferences>
              <Header locale={locale} t={t} />
              {children}
              <Footer locale={locale} t={t} />
            </SearchPreferences>
          </AiFeature>
        </PrivateAnalytics>
      </body>
    </html>
  );
}
