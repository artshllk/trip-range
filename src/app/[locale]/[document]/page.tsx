import { localePath } from "@/i18n/routing";
import { notFound } from "next/navigation";
import Link from "next/link";
import { isLocale } from "@/i18n/config";
import { legalDocuments, type LegalDocument } from "@/services/legal";
import { siteUrl } from "@/seo/registry";
type Props = { params: Promise<{ locale: string; document: string }> };
export const dynamicParams = false;
export function generateStaticParams() {
  return Object.keys(legalDocuments).map((document) => ({ document }));
}
async function documentFor({ params }: Props) {
  const { locale, document } = await params;
  if (
    !isLocale(locale) ||
    !Object.prototype.hasOwnProperty.call(legalDocuments, document)
  )
    notFound();
  const copy: LegalDocument =
    legalDocuments[document as keyof typeof legalDocuments][locale];
  return { locale, document, copy };
}
export async function generateMetadata(props: Props) {
  const { locale, document, copy } = await documentFor(props);
  return {
    title: `${copy.title} — Trip Range`,
    robots: { index: false, follow: true },
    alternates: {
      canonical: `${siteUrl}${localePath(locale, `/${document}`)}`,
    },
  };
}
export default async function Page(props: Props) {
  const { locale, copy } = await documentFor(props);
  return (
    <main id="main" className="shell section legal-page">
      <h1>{copy.title}</h1>
      {copy.paragraphs.map((p) => (
        <p key={p}>{p}</p>
      ))}
      {copy.sections?.map(({ heading, paragraphs, links }) => (
        <section key={heading}>
          <h2>{heading}</h2>
          {paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          {links?.map(({ label, href }) => (
            <p key={href}>
              <a href={href}>{label}</a>
            </p>
          ))}
        </section>
      ))}
      {locale === "en" && (
        <section>
          <h2>Who runs Trip Range?</h2>
          <p>
            Art Shllaku B.I. (Biznes Individual) operates Trip Range and is the
            data controller for the planner. The business was registered in
            Kosovo on 17 November 2023 under NUI 812102078.
          </p>
          <address>
            Rruga Halit Asllani pn, Gjakovë, Kosovo
            <br />
            <a href="mailto:hello@trip-range.com">hello@trip-range.com</a>
          </address>
          <p>
            Reviewer: Art Shllaku (owner).
          </p>
        </section>
      )}
      <Link className="btn btn-dark" href={localePath(locale, `/plan`)}>
        Start a new search
      </Link>
    </main>
  );
}
