import { localePath } from "@/i18n/routing";
import { BrandLogo } from "./BrandLogo";
import Link from "next/link";
import { Suspense } from "react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries";
import { HeaderControls } from "./HeaderControls";
import { DiscoveryNavigation } from "../discovery/DiscoveryNavigation";
export function Header({ locale }: { locale: Locale; t: Dictionary }) {
  return (
    <header className="site-header">
      <div className="shell nav">
        <Link
          href={localePath(locale)}
          className="logo"
          aria-label="Trip Range home"
        >
          <BrandLogo />
        </Link>
        <nav className="desktop-nav" aria-label="Main navigation">
          <DiscoveryNavigation />
        </nav>
        <div className="nav-right">
          <Suspense
            fallback={
              <span className="header-control" aria-hidden="true">
                …
              </span>
            }
          >
            <HeaderControls locale={locale} />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
