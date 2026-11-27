import "server-only";
import type {
  DestinationMediaDiscovery,
  MediaAsset,
  MediaCandidate,
  MediaSourceTier,
  MediaEvidence,
} from "../../domain/media/types";
import {
  object,
  safeMediaUrl,
  wikidataId,
  identityValid,
} from "../../domain/media/validation";
import {
  claimValues,
  entities,
  entityIds,
  entityText,
} from "../../places/adapters/wikidata";
import { depictionTags, evaluateCandidate } from "../operator/evaluate";
import type { MediaApi } from "./api";

export const MEDIA_CANDIDATE_LIMIT = 8;
/** Remote HTML is discarded, decoded once, then treated strictly as bounded plain text. */
export function plainMetadata(v: unknown, max = 1500): string {
  if (typeof v !== "string" || v.length > 10000) return "";
  return v
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:amp|quot|apos|lt|gt|nbsp);|&#(?:x[\da-f]+|\d+);/gi, (s) => {
      const named: Record<string, string> = {
        "&amp;": "&",
        "&quot;": '"',
        "&apos;": "'",
        "&lt;": "<",
        "&gt;": ">",
        "&nbsp;": " ",
      };
      if (named[s.toLowerCase()]) return named[s.toLowerCase()];
      const n = parseInt(
        s.slice(s.toLowerCase().startsWith("&#x") ? 3 : 2, -1),
        s.toLowerCase().startsWith("&#x") ? 16 : 10,
      );
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    })
    .replace(/[<>\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
const fileName = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= 250 &&
  !/[|<>\u0000-\u001f]/.test(v) &&
  !v.includes("://");
function metadataLicense(value: unknown) {
  if (typeof value !== "string" || value.length > 200) return "";
  try {
    const u = new URL(value);
    if (
      !["https:", "http:"].includes(u.protocol) ||
      u.hostname !== "creativecommons.org" ||
      u.port ||
      u.username ||
      u.password ||
      u.search ||
      u.hash
    )
      return "";
    const path = u.pathname
      .replace(/\/deed(?:\.[a-z-]+)?\/?$/i, "/")
      .replace(/\/?$/, "/");
    return /^\/(?:licenses\/(?:by|by-sa)\/(?:1\.0|2\.0|2\.5|3\.0|4\.0)|publicdomain\/zero\/1\.0)\/$/.test(
      path,
    )
      ? `https://creativecommons.org${path}`
      : "";
  } catch {
    return "";
  }
}
function pages(body: Record<string, unknown>) {
  if (body.query === undefined) return [];
  if (
    !object(body.query) ||
    !Array.isArray(body.query.pages) ||
    body.query.pages.length > MEDIA_CANDIDATE_LIMIT
  )
    throw Error("malformed-pages");
  return body.query.pages;
}
function assetFromPage(
  page: unknown,
  checkedAt: string,
): { asset: MediaAsset; description: string } | undefined {
  if (
    !object(page) ||
    page.ns !== 6 ||
    !Number.isSafeInteger(page.pageid) ||
    Number(page.pageid) <= 0 ||
    !Array.isArray(page.imageinfo) ||
    !object(page.imageinfo[0]) ||
    !fileName(page.title)
  )
    return;
  const info = page.imageinfo[0],
    metadata = object(info.extmetadata) ? info.extmetadata : {};
  const get = (key: string, max = 1500) =>
    plainMetadata(object(metadata[key]) ? metadata[key].value : undefined, max);
  const licenseName = get("LicenseShortName", 80),
    license = metadataLicense(get("LicenseUrl", 200));
  const author = get("Artist", 500),
    title = plainMetadata(page.title, 250),
    credit = get("Attribution") || get("Credit");
  const restricted =
    !!get("Restrictions") ||
    get("NonFree").toLowerCase() === "true" ||
    /non.?commercial|no derivatives|fair use|all rights reserved/i.test(
      get("UsageTerms"),
    );
  const sourcePage = safeMediaUrl(
    info.descriptionurl,
    "commons.wikimedia.org",
    "/wiki/File:",
  )
    ? info.descriptionurl
    : null;
  const originalUrl = safeMediaUrl(
    info.url,
    "upload.wikimedia.org",
    "/wikipedia/commons/",
    true,
  )
    ? info.url
    : null;
  return {
    asset: {
      id: `commons:${page.pageid}`,
      provider: "wikimedia-commons",
      providerFileId: String(page.pageid),
      checksum:
        typeof info.sha1 === "string" && /^[a-f0-9]{40}$/.test(info.sha1)
          ? { algorithm: "sha1", value: info.sha1 }
          : null,
      sourcePage,
      originalUrl,
      width: Number.isSafeInteger(info.width) ? Number(info.width) : 0,
      height: Number.isSafeInteger(info.height) ? Number(info.height) : 0,
      mimeType:
        info.mediatype === "BITMAP" &&
        typeof info.size === "number" &&
        info.size > 0 &&
        info.size <= 20_000_000
          ? plainMetadata(info.mime, 80)
          : "invalid",
      author,
      attribution: `${title} — ${author}${credit ? ` · ${credit}` : ""}`.slice(
        0,
        1500,
      ),
      license:
        license && !restricted
          ? { name: licenseName, url: license, verifiedAt: checkedAt }
          : null,
      health: { status: "unchecked", checkedAt: null },
    },
    description: [title, get("ImageDescription"), get("ObjectName")].join(" "),
  };
}
const imageInfo = {
  action: "query",
  prop: "imageinfo",
  iiprop: "url|size|mime|mediatype|sha1|extmetadata",
  iiextmetadatalanguage: "en",
  iiextmetadatafilter:
    "Artist|Credit|Attribution|LicenseShortName|LicenseUrl|UsageTerms|Restrictions|NonFree|ImageDescription|ObjectName",
};
export function createCommonsMediaDiscovery(
  api: MediaApi,
  now = () => new Date().toISOString(),
  observeSource?: (assetId: string, properties: string[]) => void,
): DestinationMediaDiscovery {
  return {
    async discover(identity, role, rejected) {
      if (
        !identityValid(identity) ||
        identity.external?.authority !== "wikidata" ||
        !wikidataId(identity.external.id)
      )
        return [];
      const entityId = identity.external.id;
      const root = (await entities(api, [entityId]))[0];
      if (!root) return [];
      // Direct representative views only, never flag/map/logo properties or category traversal.
      const files = [
        ...new Set(
          ["P18", "P3451", "P4291"]
            .flatMap((p) => claimValues(root, p))
            .filter(fileName),
        ),
      ].slice(0, 4);
      const rows: Array<{ page: unknown; tier: MediaSourceTier }> = [];
      if (files.length) {
        const result = await api.get("commons", {
          ...imageInfo,
          titles: files.map((f) => `File:${f}`).join("|"),
          redirects: "1",
        });
        rows.push(
          ...pages(result).map((page) => ({ page, tier: "T1" as const })),
        );
      }
      // Structured statement query only. Search results are independently checked against M-entity P180.
      const structured = await api.get("commons", {
        ...imageInfo,
        generator: "search",
        gsrsearch: `haswbstatement:P180=${entityId}`,
        gsrnamespace: "6",
        gsrlimit: "4",
        gsrprop: "",
      });
      rows.push(
        ...pages(structured).map((page) => ({ page, tier: "T2" as const })),
      );
      const deduped = new Map<
        string,
        { asset: MediaAsset; description: string; tier: MediaSourceTier }
      >();
      for (const row of rows) {
        const normalized = assetFromPage(row.page, now());
        if (
          !normalized ||
          rejected.some(
            (r) =>
              r.subject === identity.subject &&
              r.assetId === normalized.asset.id,
          )
        )
          continue;
        if (!deduped.has(normalized.asset.id))
          deduped.set(normalized.asset.id, { ...normalized, tier: row.tier });
        if (row.tier === "T1" && object(row.page)) {
          const title = String(row.page.title)
            .replace(/^File:/, "")
            .replace(/_/g, " ");
          observeSource?.(
            normalized.asset.id,
            ["P18", "P3451", "P4291"].filter((p) =>
              claimValues(root, p).some(
                (v) => typeof v === "string" && v.replace(/_/g, " ") === title,
              ),
            ),
          );
        }
      }
      const selected = [...deduped.values()].slice(0, MEDIA_CANDIDATE_LIMIT);
      const mediaEntities = await entities(
        api,
        selected.map((r) => `M${r.asset.providerFileId}`),
        "commons",
      );
      const media = new Map(mediaEntities.map((e) => [String(e.id), e]));
      const depictedIds = [
        ...new Set(mediaEntities.flatMap((e) => entityIds(e, "P180"))),
      ]
        .filter((id) => id !== entityId)
        .slice(0, 16);
      const depicted = await entities(api, depictedIds);
      const depictedById = new Map(depicted.map((e) => [String(e.id), e]));
      const candidates: MediaCandidate[] = [];
      for (const row of selected) {
        const depicts = entityIds(
          media.get(`M${row.asset.providerFileId}`) ?? {},
          "P180",
        );
        const tags = depictionTags(
          [
            row.description,
            ...depicts.flatMap((id) => entityText(depictedById.get(id) ?? {})),
          ].join(" "),
        );
        // A structured taxon/human main subject is a veto even when the filename looks scenic.
        for (const id of depicts) {
          const types = entityIds(depictedById.get(id) ?? {}, "P31");
          if (types.some((t) => ["Q16521", "Q7432"].includes(t)))
            tags.push("animal");
          if (types.includes("Q5")) tags.push("portrait");
        }
        const evidence: MediaEvidence = {
          entity: identity.external,
          exactEntityImage: row.tier === "T1",
          exactDepicts: depicts.includes(entityId),
          depictionTags: [...new Set(tags)],
          articleUsage: false,
          recognizedQuality: false,
          withinBounds: false,
        };
        // A stale search index cannot manufacture an exact depicts relationship.
        if (row.tier === "T2" && !evidence.exactDepicts)
          evidence.entity = { authority: "wikidata", id: "unresolved" };
        candidates.push(
          evaluateCandidate(identity, role, row.asset, row.tier, evidence),
        );
      }
      return candidates.sort(
        (a, b) =>
          b.evaluation.score - a.evaluation.score ||
          a.asset.id.localeCompare(b.asset.id),
      );
    },
  };
}
