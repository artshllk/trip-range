import type { PlaceIdentity } from "../places/types";
import { object, keys, text, instant } from "../places/validation";
import type { DestinationAccessData } from "./types";
import { validObservedTransfer } from "./transfer-pricing";

const code = (v: unknown) => typeof v === "string" && /^[A-Z]{3}$/.test(v);
const labels = (v: unknown) =>
  object(v) && keys(v, ["en", "sq"]) && text(v.en, 100) && text(v.sq, 100);
const sourceUrl = (v: unknown) => {
  if (typeof v !== "string" || v.length > 1000) return false;
  try {
    const u = new URL(v);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.hash &&
      !u.search &&
      !u.hostname.includes(":") &&
      !/^\d|localhost$/.test(u.hostname)
    );
  } catch {
    return false;
  }
};
export function validateDestinationAccess(
  value: unknown,
  places: readonly PlaceIdentity[],
): DestinationAccessData {
  const fail = (): never => {
    throw Error("invalid-destination-access");
  };
  if (
    !object(value) ||
    !keys(value, ["schemaVersion", "records"]) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.records)
  )
    return fail();
  const subjects = new Set<string>(),
    known = new Map(places.map((p) => [p.subject, p])),
    directCodes = new Set<string>();
  for (const r of value.records) {
    if (
      !object(r) ||
      !keys(r, [
        "destinationSubject",
        "reviewStatus",
        "reviewedAt",
        "reviewAfter",
        "reviewOwner",
        "sources",
        "gateways",
        "relationship",
        "directCity",
        "directEntries",
        "restoration",
      ]) ||
      typeof r.destinationSubject !== "string" ||
      !known.has(r.destinationSubject) ||
      subjects.has(r.destinationSubject) ||
      !["draft", "reviewed"].includes(String(r.reviewStatus)) ||
      !text(r.reviewOwner, 100) ||
      !instant(r.reviewAfter) ||
      !(r.reviewedAt === null
        ? r.reviewStatus === "draft"
        : instant(r.reviewedAt) &&
          Date.parse(r.reviewedAt) < Date.parse(r.reviewAfter)) ||
      !Array.isArray(r.sources) ||
      !r.sources.length ||
      r.sources.length > 12
    )
      return fail();
    const reviewedAt =
      typeof r.reviewedAt === "string" ? Date.parse(r.reviewedAt) : undefined;
    subjects.add(r.destinationSubject);
    const sources = new Set<string>();
    for (const s of r.sources) {
      if (
        !object(s) ||
        !keys(s, ["id", "url", "checkedAt"]) ||
        !text(s.id, 100) ||
        sources.has(s.id) ||
        !sourceUrl(s.url) ||
        !instant(s.checkedAt) ||
        (reviewedAt !== undefined && Date.parse(s.checkedAt) > reviewedAt)
      )
        return fail();
      sources.add(s.id);
    }
    const refs = (v: unknown) =>
      Array.isArray(v) &&
      v.length > 0 &&
      v.length <= 12 &&
      v.every((id) => typeof id === "string" && sources.has(id)) &&
      new Set(v).size === v.length;
    if (r.relationship === "direct-city") {
      const d = r.directCity;
      if (
        "gateways" in r ||
        "directEntries" in r ||
        "restoration" in r ||
        known.get(r.destinationSubject)?.placeKind !== "city" ||
        !object(d) ||
        !keys(d, [
          "provider",
          "providerCityCode",
          "airportCodes",
          "sourceIds",
        ]) ||
        d.provider !== "travelpayouts" ||
        !code(d.providerCityCode) ||
        !refs(d.sourceIds) ||
        !Array.isArray(d.airportCodes) ||
        !d.airportCodes.length ||
        d.airportCodes.length > 8 ||
        !d.airportCodes.every(code) ||
        new Set(d.airportCodes).size !== d.airportCodes.length
      )
        return fail();
      // One direct final city per provider code. Gateways can still share these airports.
      for (const c of new Set([d.providerCityCode, ...d.airportCodes])) {
        if (directCodes.has(c)) return fail();
        directCodes.add(c);
      }
      continue;
    }
    const mixed = r.relationship === "mixed-access";
    const entryCodes = new Set<string>();
    if (r.relationship === "direct-destination" || mixed) {
      // Nature-area direct entries are permitted only within a reviewed mixed profile.
      if (
        "directCity" in r ||
        (!mixed && "gateways" in r) ||
        !(mixed ? ["nature-area"] : ["island", "region"]).includes(
          known.get(r.destinationSubject)!.placeKind,
        ) ||
        (mixed && !r.restoration) ||
        !Array.isArray(r.directEntries) ||
        !r.directEntries.length ||
        r.directEntries.length > 8 ||
        (r.directEntries.length > 3 && !r.restoration)
      )
        return fail();
      const groups = new Set<string>(),
        airports = new Set<string>();
      for (const d of r.directEntries) {
        if (
          !object(d) ||
          !keys(d, [
            "provider",
            "providerCityCode",
            "airportCodes",
            "sourceIds",
            "cityLabel",
          ]) ||
          d.provider !== "travelpayouts" ||
          !code(d.providerCityCode) ||
          !labels(d.cityLabel) ||
          !refs(d.sourceIds) ||
          !Array.isArray(d.airportCodes) ||
          !d.airportCodes.length ||
          !d.airportCodes.every(code) ||
          groups.has(String(d.providerCityCode))
        )
          return fail();
        groups.add(String(d.providerCityCode));
        for (const a of d.airportCodes as string[]) {
          if (airports.has(a)) return fail();
          airports.add(a);
        }
        // No group/airport collision across direct final destinations or entries.
        for (const c of new Set([
          String(d.providerCityCode),
          ...(d.airportCodes as string[]),
        ])) {
          if (directCodes.has(c)) return fail();
          directCodes.add(c);
          entryCodes.add(c);
        }
      }
      if (airports.size > 8) return fail();
      // Mixed policy may select either relationship; gateway shape is validated below.
      if (mixed && Array.isArray(r.gateways))
        for (const g of r.gateways)
          if (object(g) && typeof g.providerCityCode === "string")
            groups.add(g.providerCityCode);
      if (r.restoration !== undefined) {
        const p = r.restoration;
        if (
          !object(p) ||
          !keys(p, ["providerCityCodes", "sourceIds", "rationale"]) ||
          !refs(p.sourceIds) ||
          !text(p.rationale, 1000) ||
          !Array.isArray(p.providerCityCodes) ||
          !p.providerCityCodes.length ||
          p.providerCityCodes.length > 3 ||
          !p.providerCityCodes.every(
            (c) => typeof c === "string" && groups.has(c),
          ) ||
          new Set(p.providerCityCodes).size !== p.providerCityCodes.length
        )
          return fail();
      }
      if (!mixed) continue;
    }
    if (
      (!mixed &&
        r.relationship !== undefined &&
        r.relationship !== "external-gateway") ||
      "directCity" in r ||
      (!mixed && "directEntries" in r) ||
      (!mixed && "restoration" in r) ||
      !Array.isArray(r.gateways) ||
      !r.gateways.length ||
      r.gateways.length > 8
    )
      return fail();
    const relationships = new Set<string>(),
      cityLabels = new Map<string, string>();
    for (const g of r.gateways) {
      if (
        !object(g) ||
        !keys(g, [
          "provider",
          "providerCityCode",
          "cityLabel",
          "airportCode",
          "sourceIds",
          "onwardTransfer",
        ]) ||
        g.provider !== "travelpayouts" ||
        !code(g.providerCityCode) ||
        !code(g.airportCode) ||
        !labels(g.cityLabel) ||
        !refs(g.sourceIds) ||
        !object(g.onwardTransfer) ||
        !keys(g.onwardTransfer, ["required", "pricing"]) ||
        g.onwardTransfer.required !== true ||
        !object(g.onwardTransfer.pricing)
      )
        return fail();
      const id = String(g.airportCode),
        city = String(g.providerCityCode),
        label = JSON.stringify(g.cityLabel);
      if (
        entryCodes.has(id) ||
        entryCodes.has(city) ||
        (city !== id && cityLabels.has(id)) ||
        (city !== id && relationships.has(city)) ||
        relationships.has(id) ||
        (cityLabels.has(city) && cityLabels.get(city) !== label)
      )
        return fail();
      relationships.add(id);
      cityLabels.set(city, label);
      if (cityLabels.size > (mixed ? 8 : 3)) return fail();
      const p = g.onwardTransfer.pricing;
      if (p.kind === "unpriced") {
        if (!keys(p, ["kind"])) return fail();
      } else if (p.kind === "observed") {
        if (!validObservedTransfer(p)) return fail();
      } else if (
        p.kind !== "estimate" ||
        !keys(p, ["kind", "amount", "unit", "reviewAfter", "sourceIds"]) ||
        p.unit !== "person-return" ||
        !instant(p.reviewAfter) ||
        Date.parse(p.reviewAfter) > Date.parse(r.reviewAfter) ||
        (reviewedAt !== undefined && Date.parse(p.reviewAfter) <= reviewedAt) ||
        !refs(p.sourceIds) ||
        !object(p.amount) ||
        !keys(p.amount, ["cents", "currency"]) ||
        !["EUR", "CHF", "GBP", "USD"].includes(String(p.amount.currency)) ||
        !Number.isSafeInteger(p.amount.cents) ||
        Number(p.amount.cents) <= 0 ||
        Number(p.amount.cents) > 1000000
      )
        return fail();
    }
  }
  return value as DestinationAccessData;
}
