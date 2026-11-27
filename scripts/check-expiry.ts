import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fxData } from "../content/money/fx/records";
import { destinationCostProfiles } from "../src/domain/costs/profiles";
import { auditFxExpiry, FX_ALERT_HOURS } from "./lib/fx-expiry-audit";
import {
  destinationContentDeadlines,
  guideExpiryAlerts,
} from "./lib/destination-expiry-audit";

/**
 * Daily audit of every dated input the runtime fails closed on. Each runtime check
 * drops or unprices the item once its date passes (access-store reviewAfter, transfer
 * pricing reviewAfter, FX reviewAfter, content freshness validUntil, cost profile
 * reviewAfter), and none of them tells anyone. This reports them first:
 *   expired           already failing closed in production → exit 1 (alerts)
 *   FX within 48 h    effective currency window nearly exhausted → exit 1 (alerts)
 *   other due inputs will fail closed within N days → warning
 * Usage: node .content-build/scripts/check-expiry.js [--days N]
 */
const args = process.argv.slice(2);
const days =
  args[0] === "--days" && /^\d{1,3}$/.test(args[1] ?? "")
    ? Number(args[1])
    : 14;
const now = Date.now();
type Item = { kind: string; id: string; date: string; warningHours?: number };
const items: Item[] = [];

const json = (dir: string) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      file: f,
      data: JSON.parse(readFileSync(join(dir, f), "utf8")),
    }));

for (const { file, data } of json("content/travel/access")) {
  if (typeof data.reviewAfter === "string")
    items.push({
      kind: "destination-access",
      id: file,
      date: data.reviewAfter,
    });
  for (const g of data.gateways ?? [])
    if (typeof g?.onwardTransfer?.pricing?.reviewAfter === "string")
      items.push({
        kind: "transfer-pricing",
        id: `${file} ${g.airportCode ?? ""}`.trim(),
        date: g.onwardTransfer.pricing.reviewAfter,
      });
}
const destinations = json("content/destinations");
for (const { file, data } of destinations)
  for (const entry of destinationContentDeadlines(data))
    items.push({
      kind: "destination-content",
      id: `${file} ${entry.id}`,
      date: entry.date,
    });
const fx = auditFxExpiry(fxData, now);
for (const rate of fx)
  items.push({
    kind: "fx-currency",
    id: `${rate.id}:${rate.currency}`,
    date: rate.validUntil,
    warningHours: FX_ALERT_HOURS,
  });
for (const p of destinationCostProfiles)
  if (p.reviewStatus === "reviewed")
    items.push({ kind: "cost-profile", id: p.id, date: p.reviewAfter });

const at = (d: string) =>
  Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00Z` : d);
const expired = items.filter((i) => at(i.date) <= now);
const due = items.filter(
  (i) =>
    at(i.date) > now &&
    at(i.date) <= now + (i.warningHours ?? days * 24) * 3_600_000,
);
const fxAlerts = fx.filter((rate) => rate.status !== "ok");
const byKind = (list: Item[]) =>
  Object.entries(
    list.reduce<Record<string, Item[]>>((m, i) => {
      (m[i.kind] ??= []).push(i);
      return m;
    }, {}),
  ).map(([kind, list]) => ({
    kind,
    count: list.length,
    earliest: list.map((i) => i.date).sort()[0],
    ids: list.map((i) => i.id).slice(0, 20),
  }));
for (const k of byKind(due))
  console.log(
    `::warning::${k.count} ${k.kind} item(s) approach their deadline (first ${k.earliest}).`,
  );
for (const rate of fxAlerts)
  console.log(
    `::error::FX ${rate.currency}: ${rate.status}; ECB date ${rate.sourceDate}, ${rate.validityDays}-day window, cutoff ${rate.validUntil}, ${rate.remainingHours.toFixed(1)} hours remaining. Refresh the ECB snapshot before this cutoff; no window extension or stale fallback.`,
  );
for (const k of byKind(expired))
  console.log(
    `::error::${k.count} ${k.kind} item(s) are failing closed in production now (since ${k.earliest}).`,
  );
async function report() {
  const guideAlerts = await guideExpiryAlerts(
    destinations.map(({ data }) => data),
    now,
  );
  for (const message of guideAlerts)
    console.log("::warning::Guide expiry: " + message);
  console.log(
    JSON.stringify(
      {
        status: expired.length
          ? "expired"
          : fxAlerts.length
            ? "fx-alert"
            : guideAlerts.length
              ? "guide-alert"
              : due.length
                ? "due"
                : "ok",
        checkedAt: new Date(now).toISOString(),
        windowDays: days,
        fxAlertHours: FX_ALERT_HOURS,
        fx,
        fxAlerts,
        guideAlerts,
        expired: byKind(expired),
        due: byKind(due),
        checked: items.length,
      },
      null,
      2,
    ),
  );
  process.exitCode =
    expired.length || fxAlerts.length ? 1 : guideAlerts.length ? 2 : 0;
}
void report().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
