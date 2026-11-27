import { fxData } from "../content/money/fx/records";
import {
  validateFxData,
  fxCurrencyReviewAfter,
  fxValidityDays,
} from "../src/domain/money/fx";
import { checkDestinationContentFiles } from "./lib/destination-content-files";
// Snapshots are refreshed daily by scripts/refresh-fx.mjs. An old snapshot means the
// job stopped. Check each currency's usable window so stale TRY cannot hide behind
// a still-valid CHF/GBP snapshot. Long ECB holidays can intentionally fail closed.
const WARN_DAYS = 14;
try {
  if (process.argv.length !== 2) throw Error("arguments");
  const data = validateFxData(fxData),
    now = Date.now();
  if (!checkDestinationContentFiles("content/money/fx", data.records, "id").ok)
    throw Error("manifest");
  const snapshots = data.records.map((s) => {
    const ageDays = Math.floor(
      (now - Date.parse(`${s.sourceDate}T00:00:00Z`)) / 86400000,
    );
    const currencies = s.rates.map((rate) => {
      const validityDays = fxValidityDays[rate.currency];
      const validUntil = fxCurrencyReviewAfter(s, rate.currency);
      const active =
        s.reviewStatus === "reviewed" &&
        Date.parse(s.checkedAt) <= now &&
        now < validUntil;
      return {
        currency: rate.currency,
        validityDays,
        validUntil: new Date(validUntil).toISOString(),
        active,
        level: !active
          ? "fail"
          : ageDays >= Math.min(WARN_DAYS, validityDays - 1)
            ? "warn"
            : "ok",
      };
    });
    return {
      id: s.id,
      sourceDate: s.sourceDate,
      reviewAfter: s.reviewAfter,
      ageDays,
      currencies,
      active: currencies.every((c) => c.active),
      level:
        s.reviewStatus !== "reviewed"
          ? "draft"
          : currencies.some((c) => c.level === "fail")
            ? "fail"
            : currencies.some((c) => c.level === "warn")
              ? "warn"
              : "ok",
    };
  });
  const failed = snapshots.some(
    (s) => s.level === "fail" || s.level === "draft",
  );
  const warned = snapshots.filter((s) => s.level === "warn");
  for (const s of warned)
    console.log(
      `::warning::FX snapshot ${s.id} is ${s.ageDays} days old; check the per-currency expiry windows.`,
    );
  console.log(
    JSON.stringify(
      {
        status: failed ? "failed" : warned.length ? "warning" : "passed",
        mode: "offline",
        snapshots,
        writes: 0,
        externalCalls: 0,
      },
      null,
      2,
    ),
  );
  process.exitCode = failed ? 1 : 0;
} catch {
  console.error(
    "FX validation failed: invalid arguments, manifest or snapshot.",
  );
  process.exitCode = 1;
}
