import { localePath } from "@/i18n/routing";
import { evidenceMode } from "@/providers/server/environment";
import { BrandLogo } from "./BrandLogo";
import { LegalLinks } from "./LegalLinks";
import { landingById, launchHubIds } from "@/seo/registry";
import Link from "next/link";
import { DiscoveryNavigation } from "../discovery/DiscoveryNavigation";
import { type Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries";
export function Footer({ locale, t }: { locale: Locale; t: Dictionary }) {
  return (
    <footer>
      <div className="shell">
        <div className="footer-grid">
          <div>
            <Link
              className="logo"
              aria-label="Trip Range home"
              href={localePath(locale)}
            >
              <BrandLogo />
            </Link>
            <p>{t.footTag}</p>
          </div>
          <div>
            <h3>Explore</h3>
            <DiscoveryNavigation footer />
            <Link href="/about">About Trip Range</Link>
          </div>
          <div>
            <h3>Your starting point</h3>
            <p>
              Two-night return flights for two, from Tirana, London, Barcelona
              and Warsaw.
            </p>
            {launchHubIds
              // Linked for visitors whatever the stored indexing decision.
              .flatMap((id) => {
                const page = landingById(id);
                return page ? [page] : [];
              })
              .map((page) => (
                <Link key={page.path} href={page.path}>
                  Trips from {page.origin.name}
                </Link>
              ))}
          </div>
          <div>
            <h3>Trip Range</h3>
            <Link href={localePath(locale, `/#how-it-works`)}>{t.how}</Link>
            <Link href="/methodology">
              {evidenceMode() === "off"
                ? "Estimates and your budget"
                : "How we measure fares"}
            </Link>
            {evidenceMode() === "accepted" && (
              <Link href="/data">Data and studies</Link>
            )}
            <LegalLinks locale={locale} />
          </div>
        </div>
        <div className="footer-bottom">
          <div>
            <p>{t.priceNote}</p>
            <p>{t.affiliateDisclosure}</p>
          </div>
          <span>© 2026 Trip Range</span>
        </div>
      </div>
    </footer>
  );
}
