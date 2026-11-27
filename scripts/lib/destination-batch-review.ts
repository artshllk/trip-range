import type { DestinationPopulationBatch } from "../../src/content/operator/batch";
import { editorialChecks, sha256 } from "../../src/content/operator/editorial";
import {
  instant,
  keys,
  object,
  subjectId,
  text,
} from "../../src/domain/places/validation";
import { contentItems } from "../../src/content/integrity";
import type { EditorialWorkspace } from "./editorial-workspace";
import { assessEditorialReview, reviewPins } from "./editorial-review";
import { destinationAccessData } from "../../content/travel/access/records";
import { placeRegistryData } from "../../content/places/records";
import {
  flightDestinations,
  existingAirportCodes,
} from "../../src/catalogue/flight-destinations";
import { createDestinationAccessStore } from "../../src/travel/runtime/access-store";

export type BatchPreparation = {
  schemaVersion: 1;
  batchId: string;
  preparedAt: string;
  owner: string;
  entries: {
    destinationId: string;
    pins: ReturnType<typeof reviewPins>;
    prepared: Record<(typeof editorialChecks)[number], boolean>;
    travel: {
      kind:
        | "legacy-catalogue"
        | "provider-city"
        | "direct-city"
        | "blocked"
        | "legacy-island"
        | "direct-destination"
        | "external-gateway";
      cityCode?: string;
      airports?: string[];
      groups?: { cityCode: string; airports: string[] }[];
      restorationGroups?: string[];
      checkedAt: string;
      reviewAfter: string;
      sources: string[];
    };
  }[];
};

const validCodes = (v: unknown): v is string[] =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.length <= 8 &&
  v.every((c) => typeof c === "string" && /^[A-Z]{3}$/.test(c)) &&
  new Set(v).size === v.length;
function validTravelGroups(t: Record<string, unknown>) {
  if ("restorationGroups" in t && t.kind !== "direct-destination") return false;
  const grouped = [
    "legacy-island",
    "direct-destination",
    "external-gateway",
  ].includes(String(t.kind));
  if (!grouped)
    return (
      !("groups" in t) &&
      typeof t.cityCode === "string" &&
      /^[A-Z]{3}$/.test(t.cityCode) &&
      validCodes(t.airports)
    );
  if (
    "cityCode" in t ||
    "airports" in t ||
    !Array.isArray(t.groups) ||
    !t.groups.length ||
    t.groups.length >
      (t.kind === "direct-destination" && t.restorationGroups ? 8 : 3)
  )
    return false;
  const cities = new Set<string>(),
    airports = new Set<string>();
  for (const g of t.groups) {
    if (
      !object(g) ||
      !keys(g, ["cityCode", "airports"]) ||
      typeof g.cityCode !== "string" ||
      !/^[A-Z]{3}$/.test(g.cityCode) ||
      cities.has(g.cityCode) ||
      !validCodes(g.airports)
    )
      return false;
    cities.add(g.cityCode);
    for (const a of g.airports) {
      if (airports.has(a)) return false;
      airports.add(a);
    }
  }
  return (
    airports.size <= 8 &&
    (t.restorationGroups === undefined ||
      (validCodes(t.restorationGroups) &&
        t.restorationGroups.length <= 3 &&
        t.restorationGroups.every((c) => cities.has(c))))
  );
}

/** Operator preparation observations, never an editorial review or publication input. */
export function isBatchPreparation(
  value: unknown,
  now: number,
): value is BatchPreparation {
  if (
    !object(value) ||
    !keys(value, [
      "schemaVersion",
      "batchId",
      "preparedAt",
      "owner",
      "entries",
    ]) ||
    value.schemaVersion !== 1 ||
    !subjectId(value.batchId) ||
    !instant(value.preparedAt) ||
    Date.parse(value.preparedAt) > now ||
    !text(value.owner, 100) ||
    !Array.isArray(value.entries) ||
    !value.entries.length ||
    value.entries.length > 100
  )
    return false;
  const seen = new Set<string>();
  for (const e of value.entries) {
    if (
      !object(e) ||
      !keys(e, ["destinationId", "pins", "prepared", "travel"]) ||
      !subjectId(e.destinationId) ||
      seen.has(e.destinationId) ||
      !object(e.pins) ||
      !keys(e.pins, [
        "contentVersion",
        "contentDigest",
        "identityDigest",
        "evidenceDigest",
      ]) ||
      !Number.isSafeInteger(e.pins.contentVersion) ||
      Number(e.pins.contentVersion) < 1 ||
      ![
        e.pins.contentDigest,
        e.pins.identityDigest,
        e.pins.evidenceDigest,
      ].every(sha256) ||
      !object(e.prepared) ||
      !keys(e.prepared, [...editorialChecks, "albanianCopy"]) ||
      (e.prepared.albanianCopy !== undefined &&
        typeof e.prepared.albanianCopy !== "boolean") ||
      !editorialChecks.every(
        (k) => typeof (e.prepared as Record<string, unknown>)[k] === "boolean",
      )
    )
      return false;
    seen.add(e.destinationId);
    const t = e.travel;
    if (
      !object(t) ||
      !keys(t, [
        "kind",
        "cityCode",
        "airports",
        "groups",
        "restorationGroups",
        "checkedAt",
        "reviewAfter",
        "sources",
      ]) ||
      ![
        "legacy-catalogue",
        "provider-city",
        "direct-city",
        "blocked",
        "legacy-island",
        "direct-destination",
        "external-gateway",
      ].includes(String(t.kind)) ||
      !validTravelGroups(t) ||
      !instant(t.checkedAt) ||
      Date.parse(t.checkedAt) > Date.parse(value.preparedAt) ||
      !instant(t.reviewAfter) ||
      Date.parse(t.reviewAfter) <= Date.parse(t.checkedAt) ||
      !Array.isArray(t.sources) ||
      t.sources.length !== 2 ||
      !["cities", "airports"].every((dataset) =>
        (t.sources as unknown[]).includes(
          `https://api.travelpayouts.com/data/en/${dataset}.json`,
        ),
      )
    )
      return false;
  }
  return true;
}

export function reviewDestinationBatch(
  batch: DestinationPopulationBatch,
  preparation: BatchPreparation | undefined,
  workspace: EditorialWorkspace,
  now = Date.now(),
  accessData = destinationAccessData,
) {
  const access = createDestinationAccessStore(
    accessData,
    placeRegistryData.records,
    () => now,
  );
  if (
    preparation &&
    (preparation.batchId !== batch.id ||
      preparation.entries.length !== batch.entries.length ||
      preparation.entries.some(
        (e) => !batch.entries.some((b) => b.destinationId === e.destinationId),
      ))
  )
    throw Error("preparation-batch-mismatch");
  const rows = batch.entries.map((entry) => {
    const input = workspace.inputs.get(entry.destinationId);
    if (!input) throw Error("batch-content-missing");
    const review = workspace.reviews.get(entry.destinationId);
    const assessment = assessEditorialReview({ ...input, now }, review);
    const prep = preparation?.entries.find(
      (e) => e.destinationId === entry.destinationId,
    );
    const pins = reviewPins(input);
    const reasons = [...assessment.blocking];
    if (!prep) reasons.push("preparation-not-recorded");
    else {
      if (
        (Object.keys(pins) as (keyof typeof pins)[]).some(
          (k) => prep.pins[k] !== pins[k],
        )
      )
        reasons.push("preparation-stale");
      for (const check of editorialChecks)
        if (!prep.prepared[check])
          reasons.push(`preparation-incomplete:${check}`);
    }
    const pending =
      input.record.reviewStatus === "draft" &&
      input.record.reviewedAt === null &&
      contentItems(input.record).every(
        ({ item }) => item.reviewStatus === "draft" && item.reviewedAt === null,
      ) &&
      assessment.decision === "pending" &&
      editorialChecks.every((k) => assessment.checks[k] === "pending") &&
      !input.record.publication &&
      !review?.current.warningsAcknowledged.length;
    if (!pending) reasons.push("not-pending-unpublished-draft");
    const editorialReady = reasons.length === 0;
    const travel = prep?.travel;
    let travelReady = !!travel && Date.parse(travel.reviewAfter) > now;
    const sameCodes = (a: readonly string[], b: readonly string[]) =>
      a.length === b.length && a.every((code) => b.includes(code));
    const sameGroups = (
      a: { cityCode: string; airports: string[] }[],
      b: { cityCode: string; airports: string[] }[],
    ) =>
      a.length === b.length &&
      a.every((g) => {
        const other = b.find((o) => o.cityCode === g.cityCode);
        return !!other && sameCodes(g.airports, other.airports);
      });
    if (travelReady && travel) {
      const profile = access.get(entry.destinationId);
      const direct = profile?.directCity;
      const legacy = flightDestinations.find(
        (d) => d.id === entry.destinationId,
      );
      travelReady =
        travel.kind === "direct-city"
          ? !!direct &&
            direct.providerCityCode === travel.cityCode &&
            sameCodes(direct.airportCodes, travel.airports ?? [])
          : travel.kind === "legacy-catalogue"
            ? !!legacy &&
              legacy.cityCode === travel.cityCode &&
              sameCodes(
                legacy.iataCodes ?? [],
                // A city code may also be an airport (PRN, IST). Compare the
                // complete operational alias set, including city-only groups.
                [...new Set([travel.cityCode!, ...(travel.airports ?? [])])],
              )
            : travel.kind === "provider-city"
              ? entry.destinationId === `city:${travel.cityCode}` &&
                input.identity.cityCode === travel.cityCode &&
                input.identity.confidence === "high" &&
                sameCodes(input.identity.iataCodes ?? [], travel.airports ?? [])
              : travel.kind === "legacy-island"
                ? input.identity.placeKind === "island" &&
                  !input.identity.cityCode &&
                  sameCodes(
                    existingAirportCodes[entry.destinationId] ?? [],
                    travel.groups?.flatMap((g) => g.airports) ?? [],
                  ) &&
                  sameCodes(
                    input.identity.iataCodes ?? [],
                    existingAirportCodes[entry.destinationId] ?? [],
                  ) &&
                  travel.groups!.every((g) => g.airports.includes(g.cityCode))
                : travel.kind === "direct-destination"
                  ? !!profile?.directEntries &&
                    sameGroups(
                      profile.directEntries.map((g) => ({
                        cityCode: g.providerCityCode,
                        airports: g.airportCodes,
                      })),
                      travel.groups ?? [],
                    ) &&
                    JSON.stringify(profile.restorationGroups) ===
                      JSON.stringify(travel.restorationGroups)
                  : travel.kind === "external-gateway"
                    ? !!profile?.gateways.length &&
                      sameGroups(
                        [
                          ...new Set(
                            profile.gateways.map((g) => g.providerCityCode),
                          ),
                        ].map((c) => ({
                          cityCode: c,
                          airports: profile.gateways
                            .filter((g) => g.providerCityCode === c)
                            .map((g) => g.airportCode),
                        })),
                        travel.groups ?? [],
                      )
                    : false;
    }
    if (!travelReady) reasons.push("travel-identity-blocked-or-stale");
    return {
      destinationId: entry.destinationId,
      version: input.record.contentVersion,
      digest: assessment.contentDigest,
      sources: input.record.sources.length,
      contentStatus: input.record.reviewStatus,
      blockers: reasons,
      advisories: assessment.advisory.map((a) => a.id),
      checks: assessment.checks,
      decision: assessment.decision,
      travelIdentity: travelReady ? travel!.kind : "blocked",
      receipt: input.record.publication ? "present" : "absent",
      editorialReady,
      readiness:
        editorialReady && travelReady
          ? "READY FOR HUMAN REVIEW"
          : editorialReady
            ? "EDITORIAL READY / TRAVEL IDENTITY BLOCKED"
            : "NOT READY",
    };
  });
  return {
    batch: batch.id,
    rows,
    ready: rows.filter((r) => r.readiness === "READY FOR HUMAN REVIEW").length,
    total: rows.length,
    writes: 0,
    externalCalls: 0,
    editorialApprovals: 0,
  };
}
