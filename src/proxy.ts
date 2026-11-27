import { NextResponse, type NextRequest } from "next/server";
import { evidenceMode } from "./providers/server/environment";
import { defaultLocale, localeFromPath } from "./i18n/routing";

/**
 * Locale routing: the default locale is served unprefixed. `/about` renders
 * `app/[locale]/about` with locale "en" while the address bar keeps `/about`.
 * Prefixed locales (`/sq/...`) pass through to their own segment. Public
 * `/en/...` requests redirect here, before the internal rewrite. Netlify runs
 * next.config redirects after this proxy, so a config redirect for `/en/...`
 * would also redirect the rewritten request back to itself.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/en" || pathname.startsWith("/en/")) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.slice(3) || "/";
    return NextResponse.redirect(url, 308);
  }
  if (
    pathname === "/data" ||
    pathname.startsWith("/data/") ||
    (pathname === "/methodology" && evidenceMode() !== "off")
  )
    return;
  if (localeFromPath(pathname).locale !== defaultLocale) return;
  const url = request.nextUrl.clone();
  url.pathname = `/${defaultLocale}${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Pages only: no API routes, Next internals, metadata files or public assets
  // (anything with a file extension, e.g. /robots.txt, /destinations/x.webp).
  matcher: ["/en/:path*", "/((?!api/|_next/|.*\\.[a-zA-Z0-9]+$).*)"],
};
