import {
  convertObservedAmount,
  evidenceInstant,
  validObservation,
  type FxSnapshot,
} from "../money/fx";
import { isCurrency } from "../money/currency";
import { keys, object, text } from "../places/validation";
import type {
  OnwardTransfer,
  TransferPolicy,
  TransferUnpricedReason,
} from "./types";

export function validObservedTransfer(
  p: unknown,
): p is Extract<TransferPolicy, { kind: "observed" }> {
  return (
    object(p) &&
    keys(p, [
      "kind",
      "reviewStatus",
      "reviewAfter",
      "mode",
      "basis",
      "observation",
      "unit",
      "sameFareBothDirections",
      "fxSnapshotId",
    ]) &&
    p.kind === "observed" &&
    ["draft", "reviewed"].includes(String(p.reviewStatus)) &&
    evidenceInstant(p.reviewAfter) &&
    validObservation(p.observation) &&
    Date.parse(p.reviewAfter) > Date.parse(p.observation.observedAt) &&
    Date.parse(p.reviewAfter) <=
      Date.parse(p.observation.observedAt) + 30 * 86400000 &&
    ["bus", "rail"].includes(String(p.mode)) &&
    object(p.basis) &&
    keys(p.basis, ["en", "sq"]) &&
    text(p.basis.en, 600) &&
    text(p.basis.sq, 600) &&
    p.unit === "adult-one-way" &&
    p.sameFareBothDirections === true &&
    typeof p.fxSnapshotId === "string" &&
    /^[a-z0-9-]{1,100}$/.test(p.fxSnapshotId)
  );
}
/** Per-person return allowance. The existing budget engine multiplies by every party member. */
export function resolveGatewayTransferPricing({
  policy,
  currency,
  airportConfirmed,
  snapshot,
  now,
  accessReviewAfter,
}: {
  policy: TransferPolicy;
  currency: unknown;
  airportConfirmed: boolean;
  snapshot?: FxSnapshot;
  now: number;
  accessReviewAfter: string;
}): OnwardTransfer {
  const unavailable = (reason: TransferUnpricedReason): OnwardTransfer => ({
    status: "unpriced",
    required: true,
    reason,
  });
  if (!airportConfirmed) return unavailable("airport-unconfirmed");
  if (!isCurrency(currency)) return unavailable("unsupported-currency");
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(Date.parse(accessReviewAfter)) ||
    Date.parse(accessReviewAfter) <= now
  )
    return unavailable("source-invalid");
  if (policy.kind === "unpriced") return unavailable("no-reviewed-price");
  if (
    !Number.isFinite(Date.parse(policy.reviewAfter)) ||
    Date.parse(policy.reviewAfter) <= now
  )
    return unavailable("stale-price");
  // Preserve Phase 4A's reviewed, already-denominated allowance. No currency substitution.
  if (policy.kind === "estimate") {
    if (policy.amount.currency !== currency)
      return unavailable("unsupported-currency");
    if (
      !Number.isSafeInteger(policy.amount.cents) ||
      policy.amount.cents <= 0 ||
      policy.amount.cents > 1000000
    )
      return unavailable("source-invalid");
    return {
      status: "estimate",
      required: true,
      perPersonReturn: { ...policy.amount },
      reviewAfter: new Date(
        Math.min(Date.parse(policy.reviewAfter), Date.parse(accessReviewAfter)),
      ).toISOString(),
      sourceIds: [...policy.sourceIds],
    };
  }
  if (
    !validObservedTransfer(policy) ||
    Date.parse(policy.observation.observedAt) > now
  )
    return unavailable("source-invalid");
  if (policy.reviewStatus !== "reviewed")
    return unavailable("no-reviewed-price");
  if (!snapshot || snapshot.id !== policy.fxSnapshotId)
    return unavailable("source-invalid");
  const converted = convertObservedAmount(
    policy.observation,
    currency,
    snapshot,
    now,
    2,
  );
  if (converted.status === "unpriced") return unavailable(converted.reason);
  if (converted.amount.cents > 1000000) return unavailable("overflow");
  return {
    status: "estimate",
    required: true,
    perPersonReturn: converted.amount,
    reviewAfter: new Date(
      Math.min(
        Date.parse(policy.reviewAfter),
        Date.parse(accessReviewAfter),
        Date.parse(converted.fx.validUntil),
      ),
    ).toISOString(),
    sourceIds: [policy.observation.source.id, snapshot.id],
    provenance: {
      mode: policy.mode,
      basis: { ...policy.basis },
      observation: structuredClone(policy.observation),
      derivation: "two-one-way-adult-fares",
      partyPolicy: "adult-allowance-every-traveller",
      fx: converted.fx,
      rounding: "up-target-minor-unit-per-person-return",
    },
  };
}
