/* eslint-disable @next/next/no-html-link-for-pages -- Recovery uses a full navigation so a broken router cannot prevent a new search. */
"use client";
import { RecoveryLegalFooter } from "@/components/layout/LegalLinks";
export default function GlobalError() {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: "#f5f1ea",
          color: "#1c1a17",
          fontFamily: "sans-serif",
        }}
      >
        <title>Trip Range — Try again</title>
        <meta name="robots" content="noindex" />
        <main style={{ maxWidth: 700, margin: "12vh auto", padding: 24 }}>
          <p>Trip Range</p>
          <h1>We couldn’t open this page</h1>
          <p>Your next trip can start with a new search.</p>
          <a href="/plan">Start a new search →</a>
          <div lang="sq">
            <h2>Faqja nuk mund të hapet</h2>
            <a href="/sq/plan">Fillo një kërkim të ri →</a>
          </div>
        </main>
        <RecoveryLegalFooter />
      </body>
    </html>
  );
}
