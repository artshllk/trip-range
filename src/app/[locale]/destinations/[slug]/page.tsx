import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import {
  getDestinationGuide,
  getDestinationGuides,
} from "@/services/destination-guides";
import { destinationMetadata } from "@/seo/destinations";
import { DestinationGuide } from "@/components/discovery/DestinationGuide";

/**
 * Served from the CDN. Reviewed content items hide themselves once their
 * review deadline passes; regenerating every five minutes bounds how long an
 * expired item can stay visible. Search context is added client-side on click.
 */
export const revalidate = 300;
export const dynamicParams = false;
type Props = { params: Promise<{ locale: string; slug: string }> };
export async function generateStaticParams() {
  const guides = await getDestinationGuides();
  return guides.map((guide) => ({ slug: guide.card.slug }));
}
export async function generateMetadata({ params }: Props) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const guide = await getDestinationGuide(slug);
  if (!guide) notFound();
  return destinationMetadata(guide.card);
}
export default async function Page({ params }: Props) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const guide = await getDestinationGuide(slug);
  if (!guide) notFound();
  return <DestinationGuide guide={guide} />;
}
