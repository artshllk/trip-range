/**
 * URL policy for locales (no imports: shared by the proxy, SEO identity and UI).
 *
 * The default locale is served at the root with no prefix (`/about`); every
 * other locale keeps its prefix (`/sq/about`). Internally all pages still live
 * under `app/[locale]`: `src/proxy.ts` maps an unprefixed request to the
 * default locale's segment without changing the visible URL. The proxy also
 * 308s incoming `/en/...` URLs to their unprefixed form.
 */
export const defaultLocale = "en" as const;
/** Every locale the routing knows about, served or not. */
export const routingLocales = ["en", "sq"] as const;
export type RoutingLocale = (typeof routingLocales)[number];

/** Public path for `path` (unprefixed form, starting with "/") in `locale`. */
export function localePath(locale: RoutingLocale, path = "/"): string {
  if (!path.startsWith("/"))
    throw new RangeError(`Path must start with /: ${path}`);
  if (locale === defaultLocale) return path;
  // "/" → "/sq"; "/#x" → "/sq#x"; "/?q" → "/sq?q"; "/about" → "/sq/about"
  return `/${locale}${path === "/" || /^\/[?#]/.test(path) ? path.slice(1) : path}`;
}

/** Splits a public pathname into its locale and unprefixed path. */
export function localeFromPath(pathname: string): {
  locale: RoutingLocale;
  path: string;
} {
  const match = /^\/([a-z]{2})(?=\/|$)/.exec(pathname);
  const prefixed = routingLocales.find(
    (l) => l !== defaultLocale && l === match?.[1],
  );
  if (!prefixed) return { locale: defaultLocale, path: pathname || "/" };
  return { locale: prefixed, path: pathname.slice(3) || "/" };
}
