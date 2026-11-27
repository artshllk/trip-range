import type {
  MediaAsset,
  LocalMediaDelivery,
  PlaceIdentity,
  PlaceMediaData,
  SelectionRevision,
} from "./types";
import { DESTINATION_MEDIA_ROLES, NONE_REASONS } from "./policy";

import { object, text, subjectId, instant, member } from "../places/validation";
import { validatePlaceRegistry } from "../places/validation";
export {
  object,
  text,
  subjectId,
  wikidataId,
  instant,
  coordinatesValid,
  identityValid,
} from "../places/validation";
import { identityValid } from "../places/validation";
export function safeMediaUrl(
  value: unknown,
  host: string,
  prefix: string,
  raster = false,
): value is string {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    /[\s\\\u0000-\u001f]/.test(value)
  )
    return false;
  try {
    const u = new URL(value);
    // Explicit :443 is also rejected (URL.port would normalize it away).
    if (
      !value.startsWith(`https://${host}/`) ||
      u.protocol !== "https:" ||
      u.hostname !== host ||
      u.port ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      !u.pathname.startsWith(prefix) ||
      /(?:%2f|%5c|%00|%0a|%0d)/i.test(u.pathname)
    )
      return false;
    return !raster || /\.(?:jpg|jpeg|png|webp)$/i.test(u.pathname);
  } catch {
    return false;
  }
}
export function checksumValid(v: unknown) {
  return (
    v === null ||
    (object(v) &&
      ((v.algorithm === "sha1" &&
        typeof v.value === "string" &&
        /^[a-f0-9]{40}$/.test(v.value)) ||
        (v.algorithm === "sha256" &&
          typeof v.value === "string" &&
          /^[a-f0-9]{64}$/.test(v.value))))
  );
}
export function licenseValid(v: unknown) {
  if (
    !object(v) ||
    !text(v.name, 80) ||
    !instant(v.verifiedAt) ||
    typeof v.url !== "string"
  )
    return false;
  const cc =
    /^https:\/\/creativecommons\.org\/licenses\/(by|by-sa)\/(1\.0|2\.0|2\.5|3\.0|4\.0)\/$/.exec(
      v.url,
    );
  return cc
    ? v.name === `CC ${cc[1].toUpperCase()} ${cc[2]}`
    : v.name === "CC0" &&
        v.url === "https://creativecommons.org/publicdomain/zero/1.0/";
}
/** Pure validation shared by the offline checker and fail-closed runtime store. */
export function localDeliveryValid(
  value: unknown,
  width: number,
  height: number,
): value is LocalMediaDelivery {
  if (
    !object(value) ||
    !["src,variants", "crop,src,variants"].includes(
      Object.keys(value).sort().join(),
    ) ||
    !Array.isArray(value.variants) ||
    value.variants.length < 2 ||
    value.variants.length > 8
  )
    return false;
  // Crops are an opt-in for panoramic originals only. Existing unrelated
  // source-dimension rules remain unchanged; no runtime crop is inferred.
  if (value.crop !== undefined) {
    const crop = value.crop;
    if (
      !object(crop) ||
      Object.keys(crop).sort().join() !== "height,left,top,width" ||
      ![crop.left, crop.top, crop.width, crop.height].every(
        Number.isSafeInteger,
      ) ||
      !(width / height > 2.5) ||
      Number(crop.left) < 0 ||
      Number(crop.top) < 0 ||
      Number(crop.width) <= 0 ||
      Number(crop.height) <= 0 ||
      Number(crop.left) + Number(crop.width) > width ||
      Number(crop.top) + Number(crop.height) > height
    )
      return false;
    width = Number(crop.width);
    height = Number(crop.height);
  }
  let family = "",
    previousWidth = 0;
  return (
    value.variants.some((v) => object(v) && v.src === value.src) &&
    value.variants.every((v) => {
      if (
        !object(v) ||
        Object.keys(v).sort().join() !== "bytes,height,sha256,src,width" ||
        typeof v.src !== "string"
      )
        return false;
      const match =
        /^\/destinations\/([a-z0-9]+(?:-[a-z0-9]+)*)-([1-9]\d*)\.webp$/.exec(
          v.src,
        );
      if (
        !match ||
        (family && family !== match[1]) ||
        Number(match[2]) !== v.width ||
        !Number.isSafeInteger(v.width) ||
        !Number.isSafeInteger(v.height) ||
        Number(v.width) <= previousWidth ||
        Number(v.width) < 64 ||
        Number(v.width) > Math.min(width, 8192) ||
        Number(v.height) < 1 ||
        Number(v.height) > Math.min(height, 8192) ||
        Math.abs(Number(v.width) / Number(v.height) / (width / height) - 1) >=
          0.005 ||
        !Number.isSafeInteger(v.bytes) ||
        Number(v.bytes) < 1 ||
        Number(v.bytes) > 5_000_000 ||
        typeof v.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(v.sha256)
      )
        return false;
      family = match[1];
      previousWidth = Number(v.width);
      return true;
    })
  );
}
export function sameLocalDelivery(
  a: LocalMediaDelivery,
  b: LocalMediaDelivery,
): boolean {
  return (
    a.src === b.src &&
    (a.crop === undefined
      ? b.crop === undefined
      : b.crop !== undefined &&
        a.crop.left === b.crop.left &&
        a.crop.top === b.crop.top &&
        a.crop.width === b.crop.width &&
        a.crop.height === b.crop.height) &&
    a.variants.length === b.variants.length &&
    a.variants.every((v, i) => {
      const other = b.variants[i];
      return (
        v.src === other.src &&
        v.width === other.width &&
        v.height === other.height &&
        v.bytes === other.bytes &&
        v.sha256 === other.sha256
      );
    })
  );
}
export function assetProblems(v: unknown): string[] {
  if (!object(v)) return ["invalid-asset"];
  const errors: string[] = [];
  if (
    v.provider !== "wikimedia-commons" ||
    typeof v.providerFileId !== "string" ||
    !/^[1-9]\d{0,14}$/.test(v.providerFileId) ||
    v.id !== `commons:${v.providerFileId}`
  )
    errors.push("invalid-asset-identity");
  if (!safeMediaUrl(v.sourcePage, "commons.wikimedia.org", "/wiki/File:"))
    errors.push("unsafe-source-page");
  if (
    !safeMediaUrl(
      v.originalUrl,
      "upload.wikimedia.org",
      "/wikipedia/commons/",
      true,
    )
  )
    errors.push("unsafe-image-url");
  if (!member(v.mimeType, ["image/jpeg", "image/png", "image/webp"]))
    errors.push("invalid-mime");
  if (
    typeof v.originalUrl === "string" &&
    member(v.mimeType, ["image/jpeg", "image/png", "image/webp"])
  ) {
    const extension =
      v.mimeType === "image/jpeg"
        ? /\.jpe?g$/i
        : v.mimeType === "image/png"
          ? /\.png$/i
          : /\.webp$/i;
    if (!extension.test(v.originalUrl)) errors.push("mime-extension-mismatch");
  }
  if (
    !Number.isSafeInteger(v.width) ||
    !Number.isSafeInteger(v.height) ||
    Number(v.width) <= 0 ||
    Number(v.height) <= 0 ||
    Number(v.width) > 100000 ||
    Number(v.height) > 100000
  )
    errors.push("invalid-dimensions");
  if (!text(v.author) || !text(v.attribution, 1500))
    errors.push("missing-or-unsafe-attribution");
  if (!licenseValid(v.license)) errors.push("invalid-license");
  if (!checksumValid(v.checksum)) errors.push("invalid-checksum");
  if (
    v.localDelivery !== undefined &&
    (!v.checksum ||
      !localDeliveryValid(v.localDelivery, Number(v.width), Number(v.height)))
  )
    errors.push("invalid-local-delivery");
  if (
    !object(v.health) ||
    !member(v.health.status, [
      "unchecked",
      "healthy",
      "unavailable",
      "changed",
      "withdrawn",
    ]) ||
    !(v.health.checkedAt === null || instant(v.health.checkedAt)) ||
    (v.health.status !== "unchecked" && !instant(v.health.checkedAt))
  )
    errors.push("invalid-health");
  return errors;
}
function revisionValid(
  v: unknown,
): v is SelectionRevision & Record<string, unknown> {
  if (
    !object(v) ||
    !Number.isSafeInteger(v.revision) ||
    Number(v.revision) < 1 ||
    !instant(v.selectedAt) ||
    typeof v.locked !== "boolean"
  )
    return false;
  if (v.status === "approved")
    return (
      v.method === "human-review" &&
      subjectId(v.assetId) &&
      v.locked === true &&
      instant(v.reviewedAt) &&
      v.reviewedAt <= v.selectedAt &&
      v.noneReason === null
    );
  return (
    v.status === "none" &&
    v.assetId === null &&
    member(v.noneReason, NONE_REASONS) &&
    ((v.method === "policy" && v.reviewedAt === null) ||
      (v.method === "human-review" &&
        instant(v.reviewedAt) &&
        v.reviewedAt <= v.selectedAt))
  );
}
/** Offline and runtime use the same validation. Errors contain paths/codes, never raw metadata. */
export function validateMediaData(
  value: unknown,
):
  | { ok: true; data: PlaceMediaData; errors: [] }
  | { ok: false; errors: string[] } {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.places) ||
    ![value.assets, value.selections, value.rejections].every(
      (v) => Array.isArray(v) && v.length <= 10000,
    )
  )
    return { ok: false, errors: ["invalid-store-shape"] };
  const places = value.places as unknown[],
    assets = value.assets as unknown[],
    selections = value.selections as unknown[],
    rejections = value.rejections as unknown[];
  const errors: string[] = [],
    known = new Set<string>(),
    ids = new Map<string, MediaAsset>(),
    keys = new Set<string>(),
    rejected = new Set<string>();
  places.forEach((p, i) => {
    if (!identityValid(p)) errors.push(`places[${i}]:invalid-identity`);
    else {
      if (known.has(p.subject)) errors.push(`places[${i}]:duplicate-subject`);
      known.add(p.subject);
    }
  });
  assets.forEach((a, i) => {
    errors.push(...assetProblems(a).map((e) => `assets[${i}]:${e}`));
    if (object(a) && typeof a.id === "string") {
      if (ids.has(a.id)) errors.push(`assets[${i}]:duplicate-asset`);
      ids.set(a.id, a as MediaAsset);
    }
  });
  rejections.forEach((r, i) => {
    if (
      !object(r) ||
      !subjectId(r.subject) ||
      !known.has(r.subject) ||
      !subjectId(r.assetId) ||
      !/^commons:[1-9]\d{0,14}$/.test(r.assetId) ||
      !text(r.reason, 500) ||
      !instant(r.reviewedAt)
    )
      errors.push(`rejections[${i}]:invalid-rejection`);
    else {
      const key = `${r.subject}|${r.assetId}`;
      if (rejected.has(key))
        errors.push(`rejections[${i}]:duplicate-rejection`);
      rejected.add(key);
    }
  });
  selections.forEach((s, i) => {
    const fail = (reason: string) => errors.push(`selections[${i}]:${reason}`);
    if (
      !object(s) ||
      !revisionValid(s) ||
      !subjectId(s.subject) ||
      !member(s.role, DESTINATION_MEDIA_ROLES)
    ) {
      fail("invalid-selection");
      return;
    }
    if (!known.has(s.subject)) fail("unknown-destination");
    const key = `${s.subject}|${s.role}`;
    if (keys.has(key)) fail("duplicate-subject-role");
    keys.add(key);
    if (
      !Array.isArray(s.history) ||
      s.history.length !== s.revision - 1 ||
      s.history.length > 1000
    )
      fail("invalid-history");
    else {
      const revisions: unknown[] = [...s.history, s];
      revisions.forEach((r, n) => {
        if (!revisionValid(r) || r.revision !== n + 1) {
          fail("invalid-revision");
          return;
        }
        const prev = revisions[n - 1];
        if (
          revisionValid(prev) &&
          (r.selectedAt <= prev.selectedAt ||
            (prev.status === "approved" &&
              r.status === "none" &&
              (r.noneReason !== "withdrawn" || r.method !== "human-review")) ||
            (r.status === "approved" &&
              (!r.reviewedAt ||
                r.reviewedAt <= (prev.reviewedAt ?? prev.selectedAt))))
        )
          fail("invalid-status-transition");
      });
    }
    if (!checksumValid(s.reviewedChecksum)) fail("invalid-reviewed-checksum");
    if (s.status === "none") {
      if (
        s.alt !== null ||
        s.focalPoint !== null ||
        s.reviewedChecksum !== null ||
        s.reviewedLocalDelivery !== undefined
      )
        fail("none-has-image-fields");
      return;
    }
    const asset = ids.get(s.assetId!);
    if (!asset) fail("unknown-asset");
    else {
      if (!["healthy", "unchecked"].includes(asset.health?.status))
        fail("asset-health-invalidated");
      if (JSON.stringify(s.reviewedChecksum) !== JSON.stringify(asset.checksum))
        fail("reviewed-checksum-mismatch");
      if (asset.localDelivery !== undefined) {
        if (
          !localDeliveryValid(
            s.reviewedLocalDelivery,
            asset.width,
            asset.height,
          ) ||
          !localDeliveryValid(asset.localDelivery, asset.width, asset.height) ||
          !sameLocalDelivery(s.reviewedLocalDelivery, asset.localDelivery)
        )
          fail("reviewed-delivery-mismatch");
      } else if (s.reviewedLocalDelivery !== undefined)
        fail("unexpected-reviewed-delivery");
      const frame = asset.localDelivery?.crop ?? asset;
      if (
        frame.width < 1200 ||
        frame.height < 600 ||
        frame.width / frame.height < 1.2 ||
        frame.width / frame.height > 2.5
      )
        fail("unsuitable-dimensions");
    }
    if (rejected.has(`${s.subject}|${s.assetId}`))
      fail("approved-rejected-asset");
    if (
      !object(s.alt) ||
      !text(s.alt.en, 300) ||
      Object.keys(s.alt).length > 30 ||
      !Object.entries(s.alt).every(
        ([locale, value]) =>
          /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale) && text(value, 300),
      )
    )
      fail("missing-alt-text");
    if (
      !object(s.focalPoint) ||
      ![s.focalPoint.x, s.focalPoint.y].every(
        (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1,
      )
    )
      fail("invalid-focal-point");
  });
  return errors.length
    ? { ok: false, errors }
    : { ok: true, data: value as PlaceMediaData, errors: [] };
}

function revisionSnapshot(s: SelectionRevision) {
  return {
    revision: s.revision,
    status: s.status,
    assetId: s.assetId,
    method: s.method,
    selectedAt: s.selectedAt,
    reviewedAt: s.reviewedAt,
    locked: s.locked,
    noneReason: s.noneReason,
  };
}
/** Offline review check against the previous committed authority; no runtime/network work. */
export function validateMediaChanges(
  current: PlaceMediaData,
  previous: PlaceMediaData,
): string[] {
  const errors: string[] = [];
  const currentSelections = new Map(
    current.selections.map((s) => [`${s.subject}|${s.role}`, s]),
  );
  const previousAssets = new Map(previous.assets.map((a) => [a.id, a]));
  const currentAssets = new Map(current.assets.map((a) => [a.id, a]));
  const previousPlaces = new Map(previous.places.map((p) => [p.subject, p]));
  const currentPlaces = new Map(current.places.map((p) => [p.subject, p]));
  const currentRejections = new Set(
    current.rejections.map((r) => `${r.subject}|${r.assetId}`),
  );
  for (const old of previous.selections) {
    const next = currentSelections.get(`${old.subject}|${old.role}`);
    if (!next) {
      errors.push("selection-removal-requires-reviewed-withdrawal");
      continue;
    }
    const assetChanged =
      old.assetId !== null &&
      JSON.stringify(previousAssets.get(old.assetId)) !==
        JSON.stringify(currentAssets.get(old.assetId));
    const identityChanged =
      JSON.stringify(previousPlaces.get(old.subject)) !==
      JSON.stringify(currentPlaces.get(old.subject));
    if (
      JSON.stringify(old) === JSON.stringify(next) &&
      !assetChanged &&
      !identityChanged
    )
      continue;
    if (
      next.revision !== old.revision + 1 ||
      next.history.length !== old.history.length + 1 ||
      JSON.stringify(next.history.slice(0, -1)) !==
        JSON.stringify(old.history) ||
      JSON.stringify(
        revisionSnapshot(next.history[next.history.length - 1]!),
      ) !== JSON.stringify(revisionSnapshot(old))
    )
      errors.push("selection-change-requires-next-review-revision");
    if (
      old.status === "approved" &&
      (next.method !== "human-review" ||
        !next.reviewedAt ||
        next.reviewedAt <= old.reviewedAt! ||
        (next.status === "none" && next.noneReason !== "withdrawn"))
    )
      errors.push("approved-selection-change-requires-human-review");
  }
  for (const rejection of previous.rejections)
    if (!currentRejections.has(`${rejection.subject}|${rejection.assetId}`))
      errors.push("reviewed-rejection-removal-forbidden");
  return [...new Set(errors)];
}

/** Persisted v2 media owns only media. Identities are supplied by the neutral registry.
 * The joined v1-shaped snapshot exists only for the existing policy/history checks. */
export function validateMediaRegistry(
  value: unknown,
  identities: readonly PlaceIdentity[],
) {
  if (
    !object(value) ||
    value.schemaVersion !== 2 ||
    Object.keys(value).some(
      (key) =>
        !["schemaVersion", "assets", "selections", "rejections"].includes(key),
    )
  )
    return { ok: false as const, errors: ["invalid-media-registry"] };
  const places = validatePlaceRegistry({
    schemaVersion: 1,
    records: identities,
  });
  if (!places.ok) return { ok: false as const, errors: places.errors };
  return validateMediaData({
    ...value,
    schemaVersion: 1,
    places: places.data.records,
  });
}
