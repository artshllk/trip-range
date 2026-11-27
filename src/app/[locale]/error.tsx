"use client";
import { localePath } from "@/i18n/routing";
import Link from "next/link";
import { useParams } from "next/navigation";
export default function ErrorPage({ retry }: { retry: () => void }) {
  const locale = useParams()?.locale === "sq" ? "sq" : "en";
  return (
    <main id="main" className="shell section recovery-page">
      <h1>
        {locale === "sq"
          ? "Kërkimi nuk u përfundua"
          : "We couldn’t finish this search"}
      </h1>
      <p>
        {locale === "sq"
          ? "Provo sërish ose fillo një kërkim të ri."
          : "Try again or start a new search."}
      </p>
      <button className="btn btn-dark" onClick={retry}>
        {locale === "sq" ? "Provo sërish" : "Try again"}
      </button>
      <Link href={localePath(locale, `/plan`)}>
        {locale === "sq" ? "Fillo një kërkim të ri" : "Start a new search"}
      </Link>
    </main>
  );
}
