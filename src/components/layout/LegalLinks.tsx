import { localePath, type RoutingLocale } from "@/i18n/routing";

const links = [
  { path: "/privacy", en: "Privacy", sq: "Privatësia" },
  { path: "/terms", en: "Terms", sq: "Kushtet" },
  {
    path: "/affiliate-disclosure",
    en: "Affiliate disclosure",
    sq: "Lidhjet me partnerët",
  },
] as const;

export function LegalLinks({ locale = "en" }: { locale?: RoutingLocale }) {
  return links.map(({ path, ...labels }) => (
    <a key={path} href={localePath(locale, path)}>
      {labels[locale]}
    </a>
  ));
}

// The global recovery pages can render without the layout, router or styles.
export function RecoveryLegalFooter() {
  return (
    <footer>
      <nav
        aria-label="Legal information"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "1rem",
          padding: "1rem",
        }}
      >
        <LegalLinks />
      </nav>
    </footer>
  );
}
