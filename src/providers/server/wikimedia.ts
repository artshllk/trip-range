import "server-only";
import type { Destination, ImageAsset } from "../../domain/types";
import { providerJson, record, type ProviderFetch } from "./http";

export const COMMONS_CACHE_SECONDS = 7 * 86400;
export const COMMONS_USER_AGENT =
  "TripRangeDestinationImagesBot/1.0 (https://www.trip-range.com; hello@trip-range.com)";
const LIMIT = 5;
/** Metadata is HTML, but none of it is ever rendered as HTML. */
function plain(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(?:amp|quot|apos|lt|gt|nbsp);|&#(?:x[\da-f]+|\d+);/gi,
      (entity) => {
        const named: Record<string, string> = {
          "&amp;": "&",
          "&quot;": '"',
          "&apos;": "'",
          "&lt;": "<",
          "&gt;": ">",
          "&nbsp;": " ",
        };
        if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
        const hex = entity.toLowerCase().startsWith("&#x");
        const n = parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
      },
    )
    .replace(/\s+/g, " ")
    .trim();
}
function safeUrl(
  value: unknown,
  host: string,
  prefix: string,
): string | undefined {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    if (
      host === "upload.wikimedia.org" &&
      [...url.searchParams.keys()].every((k) =>
        ["utm_source", "utm_campaign", "utm_content"].includes(k),
      )
    )
      url.search = "";
    if (
      url.protocol !== "https:" ||
      url.hostname !== host ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.startsWith(prefix)
    )
      return;
    return url.toString();
  } catch {
    return;
  }
}
function licenseUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.hostname !== "creativecommons.org" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    )
      return;
    const path = url.pathname
      .replace(/\/deed(?:\.[a-z-]+)?\/?$/i, "/")
      .replace(/\/?$/, "/");
    if (
      !/^\/(?:licenses\/(?:by|by-sa)\/(?:1\.0|2\.0|2\.5|3\.0|4\.0)|publicdomain\/zero\/1\.0)\/$/.test(
        path,
      )
    )
      return;
    return `https://creativecommons.org${path}`;
  } catch {
    return;
  }
}
function words(text: string) {
  return plain(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/);
}
function normalize(page: unknown, d: Destination): ImageAsset | undefined {
  if (
    !record(page) ||
    page.ns !== 6 ||
    typeof page.pageid !== "number" ||
    !Number.isSafeInteger(page.pageid) ||
    page.pageid <= 0 ||
    typeof page.title !== "string" ||
    !Array.isArray(page.imageinfo)
  )
    return;
  const info = page.imageinfo[0];
  if (
    !record(info) ||
    !record(info.extmetadata) ||
    info.mediatype !== "BITMAP" ||
    !["image/jpeg", "image/png", "image/webp"].includes(String(info.mime)) ||
    typeof info.width !== "number" ||
    typeof info.height !== "number" ||
    info.width < 1600 ||
    info.width / info.height < 1.3 ||
    info.width / info.height > 2.4 ||
    typeof info.size !== "number" ||
    info.size <= 0 ||
    info.size > 20_000_000
  )
    return;
  const metadata = info.extmetadata;
  const get = (key: string) =>
    record(metadata[key]) ? plain(metadata[key].value) : "";
  const author = get("Artist");
  const licenseName = get("LicenseShortName");
  const license = licenseUrl(get("LicenseUrl"));
  // A strict pair of license name + canonical terms URL. NC, ND, GFDL-only,
  // fair use and ambiguous public-domain claims are deliberately unsupported.
  const cc = license?.match(
    /^https:\/\/creativecommons\.org\/licenses\/(by|by-sa)\/(1\.0|2\.0|2\.5|3\.0|4\.0)\/$/,
  );
  const cc0 =
    license === "https://creativecommons.org/publicdomain/zero/1.0/" &&
    licenseName === "CC0";
  if (
    !author ||
    author.length > 500 ||
    !license ||
    (!cc0 &&
      (!cc ||
        licenseName.toUpperCase() !== `CC ${cc[1].toUpperCase()} ${cc[2]}`)) ||
    get("Restrictions") ||
    get("NonFree").toLowerCase() === "true" ||
    /non.?commercial|no derivatives|fair use|all rights reserved/i.test(
      get("UsageTerms"),
    )
  )
    return;
  const title = plain(page.title.replace(/^File:/, ""));
  if (/\b(map|logo|flag|diagram|coat of arms|drawing|painting)\b/i.test(title))
    return;
  const needles = words(d.name.en).filter(
    (w) =>
      ![
        "valley",
        "waterfalls",
        "waterfall",
        "lake",
        "city",
        "of",
        "the",
      ].includes(w),
  );
  const haystack = new Set(
    words(`${title} ${get("ImageDescription")} ${get("ObjectName")}`),
  );
  if (!needles.length || !needles.every((w) => haystack.has(w))) return;
  const src = safeUrl(info.url, "upload.wikimedia.org", "/wikipedia/commons/");
  const photoUrl = safeUrl(
    info.descriptionurl,
    "commons.wikimedia.org",
    "/wiki/File:",
  );
  if (!src || !photoUrl || !/\.(jpe?g|png|webp)$/i.test(new URL(src).pathname))
    return;
  const credit = get("Attribution") || get("Credit");
  if (credit.length > 1000 || title.length > 500) return;
  return {
    src,
    source: "provider",
    sourceId: `wikimedia-commons:${page.pageid}`,
    author,
    attribution: `${title} — ${author}${credit && credit !== author ? ` · ${credit}` : ""} · ${licenseName}`,
    license,
    photoUrl,
    destinationId: d.id,
    verification: "unverified",
    alt: title,
    sourceStatus: { status: "available" },
  };
}
function coordinates(d: Destination) {
  const c = d.coordinates;
  return c &&
    Number.isFinite(c.latitude) &&
    Math.abs(c.latitude) <= 90 &&
    Number.isFinite(c.longitude) &&
    Math.abs(c.longitude) <= 180
    ? c
    : undefined;
}
export function createWikimediaImages(
  catalogue: Destination[],
  fetcher: ProviderFetch = fetch,
  timeoutMs = 2500,
): { forDestination(id: string): Promise<ImageAsset> } {
  return {
    async forDestination(id) {
      const d = catalogue.find((d) => d.id === id);
      if (!d) throw new RangeError("Unknown image destination");
      if (
        d.image?.source !== "provider" &&
        d.image?.verification === "verified"
      )
        return d.image;
      const fallback = d.image;
      if (!fallback)
        throw new RangeError(
          "Legacy candidate catalogue requires a fallback record",
        );
      const fail = (reason: string): ImageAsset => ({
        ...fallback,
        sourceStatus: { status: "fallback", reason },
      });
      const c = coordinates(d);
      // At most one text query and one geographic fallback, never pagination.
      for (const geographic of c ? [false, true] : [false]) {
        const url = new URL("https://commons.wikimedia.org/w/api.php");
        const params = new URLSearchParams({
          action: "query",
          format: "json",
          formatversion: "2",
          maxlag: "5",
          prop: "imageinfo",
          iiprop: "url|size|mime|mediatype|extmetadata",
          iiextmetadatalanguage: "en",
          iiextmetadatafilter:
            "Artist|Credit|Attribution|LicenseShortName|LicenseUrl|UsageTerms|Restrictions|NonFree|ImageDescription|ObjectName",
        });
        if (geographic && c) {
          params.set("generator", "geosearch");
          params.set("ggscoord", `${c.latitude}|${c.longitude}`);
          params.set("ggsradius", "5000");
          params.set("ggsnamespace", "6");
          params.set("ggslimit", String(LIMIT));
        } else {
          params.set("generator", "search");
          params.set(
            "gsrsearch",
            d.imageQuery ?? `${d.name.en} ${d.country.en}`,
          );
          params.set("gsrnamespace", "6");
          params.set("gsrlimit", String(LIMIT));
        }
        url.search = params.toString();
        const result = await providerJson(
          url.toString(),
          { "User-Agent": COMMONS_USER_AGENT, Accept: "application/json" },
          COMMONS_CACHE_SECONDS,
          fetcher,
          timeoutMs,
        );
        if (!result.ok) return fail(result.reason);
        if (!record(result.body)) return fail("malformed-response");
        if (record(result.body.error))
          return fail(
            ["ratelimited", "maxlag"].includes(String(result.body.error.code))
              ? "rate-limit"
              : "unavailable",
          );
        // Empty generator results omit query entirely.
        if (result.body.query === undefined && "batchcomplete" in result.body)
          continue;
        if (
          !record(result.body.query) ||
          !Array.isArray(result.body.query.pages)
        )
          return fail("malformed-response");
        const pages = result.body.query.pages
          .slice(0, LIMIT)
          .sort(
            (a, b) =>
              (record(a) && typeof a.index === "number" ? a.index : 0) -
              (record(b) && typeof b.index === "number" ? b.index : 0),
          );
        for (const page of pages) {
          const image = normalize(page, d);
          if (image) return image;
        }
      }
      return fail("no-suitable-image");
    },
  };
}
