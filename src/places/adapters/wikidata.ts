import "server-only";
import type {
  PlaceIdentityResolver,
  PlaceInput,
  Coordinates,
  PlaceKind,
} from "../../domain/places/types";
import {
  coordinatesValid,
  object,
  wikidataId,
  text,
  identityValid,
} from "../../domain/places/validation";
import {
  resolvePlaceEvidence,
  reviewedIdentity,
  unresolvedIdentity,
  type PlaceEvidence,
} from "../../places/operator/identity";
import type { MediaApi } from "../../media/adapters/api";

export function claimValues(
  entity: Record<string, unknown>,
  property: string,
): unknown[] {
  const claims = object(entity.claims)
    ? entity.claims
    : object(entity.statements)
      ? entity.statements
      : {};
  const rows = claims[property];
  if (!Array.isArray(rows) || rows.length > 50) return [];
  return rows.flatMap((r) =>
    object(r) &&
    r.rank !== "deprecated" &&
    object(r.mainsnak) &&
    r.mainsnak.snaktype === "value" &&
    object(r.mainsnak.datavalue)
      ? [r.mainsnak.datavalue.value]
      : [],
  );
}
export function entityIds(entity: Record<string, unknown>, property: string) {
  return claimValues(entity, property).flatMap((v) =>
    object(v) && wikidataId(v.id) ? [v.id] : [],
  );
}
export function entityText(entity: Record<string, unknown>): string[] {
  const label =
    object(entity.labels) && object(entity.labels.en)
      ? entity.labels.en.value
      : undefined;
  const aliases =
    object(entity.aliases) && Array.isArray(entity.aliases.en)
      ? entity.aliases.en
          .slice(0, 12)
          .flatMap((v) => (object(v) ? [v.value] : []))
      : [];
  return [label, ...aliases].filter((v): v is string => text(v, 180));
}
export async function entities(
  api: MediaApi,
  ids: string[],
  service: "wikidata" | "commons" = "wikidata",
) {
  const distinct = [...new Set(ids)];
  const pattern =
    service === "wikidata" ? /^Q[1-9]\d{0,14}$/ : /^M[1-9]\d{0,14}$/;
  if (distinct.length > 32 || distinct.some((id) => !pattern.test(id)))
    throw Error("entity-bound-exceeded");
  if (!distinct.length) return [];
  const result = await api.get(service, {
    action: "wbgetentities",
    ids: distinct.join("|"),
    props: "labels|aliases|claims",
    languages: "en",
  });
  if (!object(result.entities)) throw Error("malformed-entities");
  const values = result.entities;
  return distinct.flatMap((id) => {
    const e = values[id];
    return object(e) &&
      e.id === id &&
      e.missing === undefined &&
      (service === "commons" || e.type === "item")
      ? [e]
      : [];
  });
}
// Geographic classes, never a list of cities. Unknown subclasses remain unresolved.
const geographicClasses: Readonly<Record<string, PlaceKind>> = {
  Q515: "city",
  Q3957: "city",
  Q1549591: "city",
  Q23442: "island",
  Q82794: "region",
  Q108640: "region",
  Q473972: "nature-area",
  Q46169: "nature-area",
};
const transportClasses = new Set(["Q1248784"]);
export type IdentityDiagnostic = {
  stage: "transport-code" | "constrained-name";
  evidence: PlaceEvidence[];
  excluded: Array<
    "unsupported-class" | "missing-data" | "no-transport-mapping"
  >;
};
async function normalizedEvidence(
  api: MediaApi,
  input: PlaceInput,
  roots: Record<string, unknown>[],
  transport: boolean,
  observe?: (diagnostic: IdentityDiagnostic) => void,
): Promise<PlaceEvidence[]> {
  const excluded: IdentityDiagnostic["excluded"] = [];
  const candidates = [...roots];
  const codeById = new Map<string, string[]>();
  const served = new Set<string>();
  for (const r of roots) {
    const codes = claimValues(r, "P238").filter(
      (v): v is string =>
        typeof v === "string" &&
        /^[A-Z]{3}$/.test(v) &&
        [input.cityCode, ...(input.iataCodes ?? [])].includes(v),
    );
    if (transport && !codes.length) continue;
    codeById.set(String(r.id), codes);
    for (const id of entityIds(r, "P931")) {
      served.add(id);
      codeById.set(id, [...new Set([...(codeById.get(id) ?? []), ...codes])]);
    }
  }
  if (served.size > 12) throw Error("ambiguous-transport-hub");
  if (served.size) candidates.push(...(await entities(api, [...served])));
  const metadataIds = [
    ...new Set(
      candidates.flatMap((e) => [
        ...entityIds(e, "P17"),
        ...entityIds(e, "P31"),
      ]),
    ),
  ];
  const metadata = await entities(api, metadataIds);
  const byId = new Map(metadata.map((e) => [String(e.id), e]));
  const evidence = candidates.flatMap((e) => {
    const classes = entityIds(e, "P31");
    if (
      entityIds(e, "P931").length ||
      classes.some((c) => transportClasses.has(c))
    )
      return [];
    const kinds = [
      ...new Set(
        classes
          .flatMap((c) => [c, ...entityIds(byId.get(c) ?? {}, "P279")])
          .flatMap((c) => (geographicClasses[c] ? [geographicClasses[c]] : [])),
      ),
    ];
    if (kinds.length !== 1) {
      excluded.push("unsupported-class");
      return [];
    }
    const countries = [
      ...new Set(
        entityIds(e, "P17")
          .flatMap((c) => claimValues(byId.get(c) ?? {}, "P297"))
          .filter(
            (c): c is string => typeof c === "string" && /^[A-Z]{2}$/.test(c),
          ),
      ),
    ];
    if (countries.length !== 1) {
      excluded.push("missing-data");
      return [];
    }
    const points = claimValues(e, "P625").filter(
      (v) =>
        coordinatesValid(v) &&
        object(v) &&
        v.globe === "http://www.wikidata.org/entity/Q2",
    );
    const coordinates =
      points.length === 1
        ? {
            latitude: (points[0] as Coordinates).latitude,
            longitude: (points[0] as Coordinates).longitude,
          }
        : undefined;
    return [
      {
        external: { authority: "wikidata", id: String(e.id) },
        names: entityText(e),
        countryCode: countries[0],
        placeKind: kinds[0],
        coordinates,
        transportCodes: codeById.get(String(e.id)) ?? [],
      },
    ];
  });
  if (transport && !evidence.some((e) => e.transportCodes.length))
    excluded.push("no-transport-mapping");
  observe?.({
    stage: transport ? "transport-code" : "constrained-name",
    evidence,
    excluded: [...new Set(excluded)],
  });
  return evidence;
}
export function createWikidataIdentityResolver(
  api: MediaApi,
  now = () => new Date().toISOString(),
  observe?: (diagnostic: IdentityDiagnostic) => void,
): PlaceIdentityResolver {
  return {
    async resolve(input, reviewed) {
      const mapped = reviewedIdentity(input, reviewed);
      if (mapped) return mapped;
      const initial = unresolvedIdentity(input, "no-reviewed-mapping");
      if (!identityValid(initial))
        return unresolvedIdentity(input, "invalid-input");
      try {
        const codes = [
          ...new Set(
            [input.cityCode, ...(input.iataCodes ?? [])].filter(
              (v): v is string => !!v,
            ),
          ),
        ];
        if (codes.length > 12)
          return unresolvedIdentity(input, "transport-code-bound-exceeded");
        if (codes.length) {
          const result = await api.get("wikidata", {
            action: "query",
            list: "search",
            srnamespace: "0",
            srlimit: "7",
            srsearch: codes.map((c) => `haswbstatement:P238=${c}`).join(" OR "),
            srprop: "",
          });
          if (!object(result.query) || !Array.isArray(result.query.search))
            throw Error("malformed-search");
          if (result.continue || result.query.search.length > 6)
            return unresolvedIdentity(input, "ambiguous-transport-code");
          const ids = result.query.search.flatMap((r) =>
            object(r) && wikidataId(r.title) ? [r.title] : [],
          );
          if (ids.length !== result.query.search.length)
            throw Error("malformed-search");
          const evidence = await normalizedEvidence(
            api,
            input,
            await entities(api, ids),
            true,
            observe,
          );
          const found = resolvePlaceEvidence(
            input,
            evidence,
            "transport-code",
            now(),
          );
          if (found.external || found.unresolvedReason === "ambiguous-identity")
            return found;
        }
        if (!input.coordinates)
          return unresolvedIdentity(
            input,
            "coordinates-required-for-name-resolution",
          );
        const result = await api.get("wikidata", {
          action: "wbsearchentities",
          search: input.name,
          language: "en",
          uselang: "en",
          type: "item",
          limit: "7",
        });
        if (!Array.isArray(result.search)) throw Error("malformed-search");
        if (result["search-continue"] !== undefined || result.search.length > 6)
          return unresolvedIdentity(input, "ambiguous-name");
        const ids = result.search.flatMap((r) =>
          object(r) && wikidataId(r.id) ? [r.id] : [],
        );
        if (ids.length !== result.search.length)
          throw Error("malformed-search");
        const evidence = await normalizedEvidence(
          api,
          input,
          await entities(api, ids),
          false,
          observe,
        );
        return resolvePlaceEvidence(input, evidence, "constrained-name", now());
      } catch {
        return unresolvedIdentity(input, "provider-unavailable-or-bounded");
      }
    },
  };
}
