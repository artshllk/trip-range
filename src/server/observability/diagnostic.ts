import type { DiscoveryDiagnostic } from "../../domain/types";
import { isCurrency, type CurrencyCode } from "../../domain/money/currency";
import type { LogLevel } from "./log-level";
const components = [
  "search",
  "money",
  "provider",
  "seo",
  "affiliate",
  "ai",
  "store",
] as const;
const operations = [
  "cost-profile",
  "accommodation-evidence",
  "accommodation-provider",
  "flight-pricing",
  "discovery-evidence",
  "flight-affordability",
  "currency-policy",
  "request-normalization",
  "provider-scope",
  "provider-currency",
  "destination-resolution",
  "nearby-comparison",
  "seo-quality",
  "affiliate-handoff",
  "ai-resolution",
  "fare-store-write",
  "fare-store-read",
  "fare-store-prune",
  "fare-warm",
  "affiliate-event",
] as const;
const statuses = [
  "reviewed-profile",
  "generic-fallback",
  "ready",
  "calculated",
  "no-room-in-budget",
  "required-transfer-unpriced",
  "stay-unpriced",
  "accommodation-charges-unpriced",
  "fit-unconfirmed",
  "provider-priced",
  "reviewed-estimate",
  "generic-estimate",
  "empty",
  "disabled",
  "stale",
  "fallback",
  "mismatch",
  "unconfirmed",
  "no-results",
  "clarification",
  "indexable",
  "noindex",
  "unavailable",
  "invalid-input",
  "excluded",
  "available",
  "recorded",
  "failed",
  "timeout",
] as const;
export type DiagnosticEvent = {
  level: Exclude<LogLevel, "off">;
  component: (typeof components)[number];
  operation: (typeof operations)[number];
  status: (typeof statuses)[number];
  originCode?: string;
  destinationCode?: string;
  currency?: CurrencyCode;
  market?: "us";
  state?: "matching-fare" | "reference-only" | "unavailable";
  dateMode?: "exact" | "flexible" | "weekends";
  provider?: "travelpayouts";
  evidence?: DiscoveryDiagnostic["code"];
  count?: number;
  durationMs?: number;
  affiliateReason?:
    | "configuration"
    | "malformed"
    | "unsupported"
    | "timeout"
    | "authentication"
    | "rate-limit"
    | "provider";
};
/** Reconstruct fields rather than spreading caller data. Never accepts prompts, URLs, query strings or arbitrary IDs. */
export function safeDiagnosticEvent(input: DiagnosticEvent): DiagnosticEvent {
  const result: DiagnosticEvent = {
    level: ["debug", "info", "warn", "error"].includes(input.level)
      ? input.level
      : "info",
    component: components.includes(input.component)
      ? input.component
      : "provider",
    operation: operations.includes(input.operation)
      ? input.operation
      : "request-normalization",
    status: statuses.includes(input.status) ? input.status : "unavailable",
  };
  for (const key of ["originCode", "destinationCode"] as const)
    if (typeof input[key] === "string" && /^[A-Z]{3}$/.test(input[key]))
      result[key] = input[key];
  if (
    ["matching-fare", "reference-only", "unavailable"].includes(
      input.state ?? "",
    )
  )
    result.state = input.state;
  if (["exact", "flexible", "weekends"].includes(input.dateMode ?? ""))
    result.dateMode = input.dateMode;
  if (
    [
      "unknown-destination",
      "schema-invalid",
      "currency-from-request",
      "sample-limit-reached",
      "date-unmatched",
      "malformed-row",
      "date-mismatch",
      "scope-mismatch",
      "provider-empty",
      "provider-failed",
      "stale-fare",
      "observation-unconfirmed",
      "reference-only",
      "currency-rejected",
      "targeted-restoration",
      "gateway-restoration",
    ].includes(input.evidence ?? "")
  )
    result.evidence = input.evidence;
  if (input.provider === "travelpayouts") result.provider = input.provider;
  if (
    [
      "configuration",
      "malformed",
      "unsupported",
      "timeout",
      "authentication",
      "rate-limit",
      "provider",
    ].includes(input.affiliateReason ?? "")
  )
    result.affiliateReason = input.affiliateReason;
  if (isCurrency(input.currency)) result.currency = input.currency;
  if (input.market === "us") result.market = "us";
  for (const key of ["count", "durationMs"] as const)
    if (typeof input[key] === "number" && Number.isFinite(input[key]))
      result[key] = Math.min(
        key === "count" ? 1000 : 60000,
        Math.max(0, Math.round(input[key])),
      );
  return result;
}
