import {
  validateFxData,
  fxCurrencyReviewAfter,
  fxValidityDays,
  FX_WINDOW_POLICY,
} from "../../src/domain/money/fx";

// Two daily opportunities to warn before a four-day TRY rate expires. This is
// independent of whether the refresh workflow started or reported success.
export const FX_ALERT_HOURS = 48;

export function auditFxExpiry(input: unknown, now: number) {
  if (!Number.isFinite(now)) throw Error("invalid-audit-clock");
  const { records } = validateFxData(input);
  if (!records.length) throw Error("missing-fx-snapshot");
  return records.flatMap((snapshot) =>
    snapshot.rates.map(({ currency }) => {
      const deadline = fxCurrencyReviewAfter(snapshot, currency);
      const unusable =
        snapshot.reviewStatus !== "reviewed" ||
        Date.parse(snapshot.checkedAt) > now;
      return {
        id: snapshot.id,
        currency,
        sourceDate: snapshot.sourceDate,
        checkedAt: snapshot.checkedAt,
        sourceUrl: snapshot.sourceUrl,
        windowPolicy: FX_WINDOW_POLICY,
        validityDays: fxValidityDays[currency],
        validUntil: new Date(deadline).toISOString(),
        remainingHours: (deadline - now) / 3_600_000,
        status: unusable
          ? ("unusable" as const)
          : deadline <= now
            ? ("expired" as const)
            : deadline - now <= FX_ALERT_HOURS * 3_600_000
              ? ("approaching-expiry" as const)
              : ("ok" as const),
      };
    }),
  );
}
