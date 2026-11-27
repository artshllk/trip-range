import type { PlaceIdentity } from "../../domain/places/types";
import { validatePlaceRegistry } from "../../domain/places/validation";

/** Private snapshot with indexed lookups; invalid registries cannot partially resolve. */
export function createPlaceRegistry(input: unknown) {
  const checked = validatePlaceRegistry(structuredClone(input));
  if (!checked.ok) throw Error("invalid-place-registry");
  const records = checked.data.records;
  const bySubject = new Map(records.map((record) => [record.subject, record]));
  const byExternal = new Map(
    records.filter((r) => r.external).map((r) => [r.external!.id, r]),
  );
  const byCode = new Map<string, PlaceIdentity>();
  for (const record of records)
    for (const code of [
      ...(record.iataCodes ?? []),
      ...(record.cityCode ? [record.cityCode] : []),
    ])
      byCode.set(code, record);
  const copy = (record: PlaceIdentity | undefined) =>
    record && structuredClone(record);
  return {
    size: records.length,
    get: (subject: string) => copy(bySubject.get(subject)),
    byWikidata: (id: string) => copy(byExternal.get(id)),
    byTransportCode: (code: string) => copy(byCode.get(code)),
    list: () => structuredClone(records),
  };
}
