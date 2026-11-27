import { localeFromPath } from "../i18n/routing";
import { isEnglishLandingPath } from "../seo/paths";
/** Analytics URL metadata must not carry planner queries, snapshots or free text. */
export function sanitizeAnalyticsEvent<T extends { url: string }>(
  event: T,
): T | null {
  try {
    const url = new URL(event.url);
    // English is unprefixed; other locales keep their prefix.
    const { path } = localeFromPath(url.pathname);
    if (
      !isEnglishLandingPath(path) &&
      !/^\/(?:(?:plan(?:\/results|\/trips\/[^/]{1,80})?|privacy|terms|affiliate-disclosure)\/?)?$/.test(
        path,
      )
    )
      return null;
    if (/\/plan\/trips\//.test(url.pathname))
      url.pathname = url.pathname.replace(
        /\/trips\/.*/,
        "/trips/[destination]",
      );
    url.search = "";
    url.hash = "";
    url.username = "";
    url.password = "";
    return { ...event, url: url.toString() };
  } catch {
    return null;
  }
}
