import type { PlaceIdentity, PlaceRegistryData } from "./types";
import { PLACE_IDENTITY_POLICY_VERSION, PLACE_KINDS } from "./policy";
export const keys = (v: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(v).every((key) => allowed.includes(key));
const COUNTRY_CODES = new Set(
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW".split(
    " ",
  ),
);
export const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export const text = (v: unknown, max = 500): v is string =>
  typeof v === "string" &&
  !!v.trim() &&
  v.length <= max &&
  !/[<>\u0000-\u001f\u007f-\u009f]/.test(v);
export const subjectId = (v: unknown): v is string =>
  typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,119}$/.test(v);
export const wikidataId = (v: unknown): v is string =>
  typeof v === "string" && /^Q[1-9]\d{0,14}$/.test(v);
export const instant = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().replace(".000Z", "Z") === v.replace(".000Z", "Z");
export const member = (v: unknown, list: readonly string[]) =>
  typeof v === "string" && list.includes(v);
export const coordinatesValid = (v: unknown) =>
  object(v) &&
  typeof v.latitude === "number" &&
  Number.isFinite(v.latitude) &&
  Math.abs(v.latitude) <= 90 &&
  typeof v.longitude === "number" &&
  Number.isFinite(v.longitude) &&
  Math.abs(v.longitude) <= 180;
export function identityValid(v: unknown): v is PlaceIdentity {
  if (
    !object(v) ||
    !keys(v, [
      "subject",
      "name",
      "countryCode",
      "placeKind",
      "coordinates",
      "iataCodes",
      "cityCode",
      "external",
      "resolutionMethod",
      "confidence",
      "resolvedAt",
      "unresolvedReason",
      "policyVersion",
      "aliases",
    ]) ||
    !subjectId(v.subject) ||
    !text(v.name, 180) ||
    !member(v.placeKind, PLACE_KINDS) ||
    typeof v.countryCode !== "string" ||
    !COUNTRY_CODES.has(v.countryCode) ||
    v.policyVersion !== PLACE_IDENTITY_POLICY_VERSION
  )
    return false;
  if (
    v.aliases !== undefined &&
    !(
      Array.isArray(v.aliases) &&
      v.aliases.length <= 40 &&
      v.aliases.every((a) => text(a, 180) && a.trim() === a) &&
      new Set(v.aliases.map((a: string) => a.normalize("NFKC").toLowerCase()))
        .size === v.aliases.length
    )
  )
    return false;
  if (
    v.coordinates !== undefined &&
    (!coordinatesValid(v.coordinates) ||
      !object(v.coordinates) ||
      !keys(v.coordinates, ["latitude", "longitude"]))
  )
    return false;
  if (
    v.cityCode !== undefined &&
    !(typeof v.cityCode === "string" && /^[A-Z]{3}$/.test(v.cityCode))
  )
    return false;
  if (
    v.iataCodes !== undefined &&
    !(
      Array.isArray(v.iataCodes) &&
      v.iataCodes.length <= 12 &&
      v.iataCodes.every((c) => typeof c === "string" && /^[A-Z]{3}$/.test(c)) &&
      new Set(v.iataCodes).size === v.iataCodes.length
    )
  )
    return false;
  if (v.resolutionMethod === "unresolved")
    return (
      v.external === null &&
      v.confidence === "unresolved" &&
      v.resolvedAt === null &&
      text(v.unresolvedReason, 120)
    );
  return (
    object(v.external) &&
    keys(v.external, ["authority", "id"]) &&
    v.external.authority === "wikidata" &&
    wikidataId(v.external.id) &&
    instant(v.resolvedAt) &&
    v.unresolvedReason === null &&
    (v.resolutionMethod === "reviewed"
      ? v.confidence === "reviewed"
      : member(v.resolutionMethod, ["transport-code", "constrained-name"]) &&
        v.confidence === "high")
  );
}

/** O(n) validation. Names may legitimately repeat; external/transport identity must not. */
export function validatePlaceRegistry(
  value: unknown,
):
  | { ok: true; data: PlaceRegistryData; errors: [] }
  | { ok: false; errors: string[] } {
  if (
    !object(value) ||
    !keys(value, ["schemaVersion", "records"]) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.records)
  )
    return { ok: false, errors: ["invalid-place-registry"] };
  const subjects = new Set<string>(),
    external = new Set<string>(),
    codes = new Map<string, string>();
  const errors: string[] = [];
  const fail = (i: number, code: string) => {
    if (errors.length < 100) errors.push(`records[${i}]:${code}`);
  };
  value.records.forEach((record: unknown, i: number) => {
    if (!identityValid(record)) {
      fail(i, "invalid-identity");
      return;
    }
    if (subjects.has(record.subject)) fail(i, "duplicate-subject");
    subjects.add(record.subject);
    if (record.external) {
      const id = `${record.external.authority}:${record.external.id}`;
      if (external.has(id)) fail(i, "duplicate-external-identity");
      external.add(id);
    }
    for (const code of new Set([
      ...(record.iataCodes ?? []),
      ...(record.cityCode ? [record.cityCode] : []),
    ])) {
      if (codes.has(code) && codes.get(code) !== record.subject)
        fail(i, "conflicting-transport-code");
      codes.set(code, record.subject);
    }
  });
  return errors.length
    ? { ok: false, errors }
    : { ok: true, data: value as PlaceRegistryData, errors: [] };
}
