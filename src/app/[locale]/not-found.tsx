"use client";
import { localePath } from "@/i18n/routing";
import Link from "next/link";
import { useParams } from "next/navigation";
export default function NotFound() {
  const locale = useParams()?.locale === "sq" ? "sq" : "en";
  return (
    <main id="main" className="shell section recovery-page">
      <p className="eyebrow">404 · Trip Range</p>
      <h1>
        {locale === "sq"
          ? "Kjo faqe nuk u gjet"
          : "This page could not be found"}
      </h1>
      <p>
        {locale === "sq"
          ? "Lidhja mund të jetë e vjetër. Provo një kërkim të ri."
          : "This link may be out of date. Try a new search."}
      </p>
      <Link className="btn btn-dark" href={localePath(locale, `/plan`)}>
        {locale === "sq" ? "Fillo një kërkim të ri" : "Start a new search"}
      </Link>
    </main>
  );
}
