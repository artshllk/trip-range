import { isCurrency, majorUnits } from "../../domain/money/currency";
import { readMoneyIntent } from "../../domain/money/intent";
import { planningCurrency } from "../../domain/market/policy";
import { findLocation } from "../../catalogue/locations";
import {
  addDays,
  isCalendarDate,
  nightsBetween,
  resolveTravelDates,
  weekendsInMonth,
} from "../../domain/dates";
import { parseRequest, requestQuery, type Query } from "../../domain/request";
import { validateDraft } from "../../domain/ai/validation";
import type { TravelIntent, IntentResolution } from "../../domain/ai/intent";
import type { LocationSearch } from "../../providers/contracts";
import { readLocation } from "../../domain/locations";
const normalized = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
function calendarDate(raw: string | null, today: string, after?: string) {
  if (!raw) return;
  let value = raw;
  if (/^\d{2}-\d{2}$/.test(raw)) {
    const base = after ?? today;
    value = `${base.slice(0, 4)}-${raw}`;
    if (value < base) value = `${Number(base.slice(0, 4)) + 1}-${raw}`;
  }
  return isCalendarDate(value) ? value : undefined;
}
/** Model output is an untrusted patch. GoEksplo resolves every final location/date and bound. */
export async function resolveTravelIntent(
  intent: TravelIntent,
  draft: Query,
  text: string,
  today: string,
  locations: LocationSearch,
): Promise<IntentResolution> {
  const current = validateDraft(draft, today);
  const q: Query = {
    ...Object.fromEntries(new URLSearchParams(requestQuery(current.request))),
  };
  const problems = new Set(current.fields);
  const clarifications: IntentResolution["clarifications"] = [];
  const locationChanges = await Promise.all(
    (["origin", "destination"] as const).map(async (field) => {
      const term =
        intent[field === "origin" ? "originQuery" : "destinationQuery"];
      if (!term) return;
      // Only extracted name fragments may reach autocomplete, never the full prompt or instructions.
      if (
        !` ${normalized(text)} `.includes(` ${normalized(term)} `) ||
        term.split(/\s+/).length > 8
      )
        return { field, choices: [] };
      let choices: ReturnType<typeof readLocation>[] = [];
      try {
        choices = (await locations.search(term)).locations
          .map(readLocation)
          .filter(Boolean);
      } catch {}
      const valid = choices.filter(
        (l): l is NonNullable<typeof l> =>
          !!l && (field !== "origin" || l.type !== "country"),
      );
      const exact = valid.filter(
        (l) => normalized(l.name) === normalized(term),
      );
      const exactCities = exact.filter((l) => l.type === "city");
      const matches = exactCities.length
        ? exactCities
        : exact.length
          ? exact
          : [];
      return matches.length === 1
        ? { field, location: matches[0] }
        : { field, choices: valid.slice(0, 8) };
    }),
  );
  for (const change of locationChanges) {
    if (!change) continue;
    if (change.location) {
      if (change.field === "origin") {
        q.origin = change.location.id;
        q.originPlace = JSON.stringify(change.location);
        if (change.location.id !== current.request.originId)
          q.currency = planningCurrency(change.location).currency;
      } else q.toPlace = JSON.stringify(change.location);
      problems.delete(change.field);
    } else {
      problems.add(change.field);
      clarifications.push({ field: change.field, choices: change.choices });
    }
  }
  if (intent.anywhere) {
    delete q.toPlace;
    problems.delete("destination");
  }
  if (intent.budgetAmount !== null) {
    q.budget = String(intent.budgetAmount);
    problems.delete("budget");
  }
  const explicitMoney = readMoneyIntent(text);
  const explicitCurrency =
    explicitMoney.status === "explicit"
      ? explicitMoney.amount.currency
      : intent.currency;
  if (explicitMoney.status === "explicit")
    q.budget = majorUnits(explicitMoney.amount);
  const resolvedOrigin = parseRequest(q, undefined, today);
  const policy = planningCurrency(
    resolvedOrigin.origin ?? findLocation(resolvedOrigin.originId),
  );
  if (
    explicitMoney.status === "ambiguous" ||
    explicitCurrency === "unsupported"
  )
    problems.add("currency");
  else if (isCurrency(explicitCurrency)) {
    q.currency = explicitCurrency;
    if (explicitCurrency !== policy.currency) problems.add("currency");
    else problems.delete("currency");
  }
  if (intent.travellersAmbiguous) {
    if (
      problems.has("party") ||
      intent.travellerTotal === null ||
      current.request.party.adults + current.request.party.children !==
        intent.travellerTotal
    )
      problems.add("party");
  } else if (intent.adults !== null || intent.children !== null) {
    if (intent.adults !== null) q.adults = String(intent.adults);
    if (intent.children !== null) q.children = String(intent.children);
    if (
      !current.fields.includes("party") ||
      (intent.adults !== null && intent.children !== null)
    )
      problems.delete("party");
  }
  if (intent.styles !== null) q.styles = [...new Set(intent.styles)].join(",");
  if (intent.stayLevel !== null) q.stay = intent.stayLevel;
  for (const [field, key] of [
    ["nearbyAirports", "airports"],
    ["luggage", "luggage"],
    ["noFlight", "noFlight"],
    ["familyStay", "family"],
  ] as const)
    if (intent[field] !== null) q[key] = intent[field] ? "1" : "0";
  const d = intent.dateIntent;
  if (d) {
    let dates;
    if (d.type === "this-weekend" || d.type === "next-weekend") {
      q.when = d.type === "this-weekend" ? "weekend" : "next-weekend";
      dates = resolveTravelDates(
        d.type === "this-weekend" ? "weekend" : "next-weekend",
        today,
        current.request.nights,
      );
    } else if (d.type === "any-weekend") {
      let month = d.month ?? "";
      if (/^\d{2}$/.test(month)) {
        month = `${today.slice(0, 4)}-${month}`;
        if (month < today.slice(0, 7))
          month = `${Number(today.slice(0, 4)) + 1}-${d.month}`;
      }
      const first = weekendsInMonth(month, today)[0];
      if (first) dates = { ...first, mode: "weekends" as const, month };
    } else {
      const start =
        calendarDate(d.start, today) ??
        (d.type === "flexible-three-days" &&
        d.start === null &&
        !current.fields.includes("dates")
          ? current.request.dates.startDate
          : undefined);
      const end =
        calendarDate(d.end, today, start) ??
        (start && d.end === null
          ? addDays(start, current.request.nights)
          : undefined);
      if (
        start &&
        end &&
        start >= today &&
        nightsBetween(start, end) >= 1 &&
        nightsBetween(start, end) <= 14
      )
        dates = {
          startDate: start,
          endDate: end,
          flexibleDays: d.type === "flexible-three-days" ? 3 : 0,
        };
    }
    if (dates) {
      q.start = dates.startDate;
      q.end = dates.endDate;
      q.flexDays = String(dates.flexibleDays);
      q.when = ["this-weekend", "next-weekend"].includes(d.type)
        ? q.when
        : "custom";
      delete q.dateMode;
      delete q.month;
      if ("mode" in dates) {
        q.dateMode = dates.mode;
        q.month = dates.month;
      }
      problems.delete("dates");
    } else problems.add("dates");
  }
  delete q.departure;
  const validated = validateDraft(q, today);
  for (const field of validated.fields) problems.add(field);
  for (const field of problems)
    if (!clarifications.some((c) => c.field === field))
      clarifications.push({ field });
  return {
    status: problems.size ? "clarification" : "ready",
    request: parseRequest(q, undefined, today),
    clarifications: clarifications.filter((c) => problems.has(c.field)),
    unsupportedPreferences: [...new Set(intent.unsupportedPreferences)],
  };
}
