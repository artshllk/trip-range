/* eslint-disable @next/next/no-html-link-for-pages -- Recovery uses a full navigation so a broken router cannot prevent a new search. */
import "./globals.css";
import { RecoveryLegalFooter } from "@/components/layout/LegalLinks";
export const metadata = {
  title: "Page not found — Trip Range",
  robots: { index: false, follow: true },
};
export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body>
        <main id="main" className="shell section recovery-page">
          <p className="eyebrow">404 · Trip Range</p>
          <h1>This page could not be found</h1>
          <a className="btn btn-dark" href="/plan">
            Start a new search →
          </a>
          <div lang="sq">
            <h2>Kjo faqe nuk u gjet</h2>
            <a href="/sq/plan">Fillo një kërkim të ri →</a>
          </div>
        </main>
        <RecoveryLegalFooter />
      </body>
    </html>
  );
}
