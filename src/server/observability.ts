import "server-only";
import { serverEnvironment } from "../providers/server/environment";
import { shouldLog } from "./observability/log-level";
import {
  safeDiagnosticEvent,
  type DiagnosticEvent,
} from "./observability/diagnostic";
export type Operation =
  | "flight-discovery"
  | "location-search"
  | "destination-metadata"
  | "image-search"
  | "affiliate-link"
  | "intent"
  | "explanations"
  | "provider-admission"
  | "rate-limit";
export type Provider =
  | "travelpayouts"
  | "wikimedia"
  | "pexels"
  | "openai"
  | "limiter";
const reasons = [
  "success",
  "timeout",
  "rate-limit",
  "admission-unavailable",
  "authentication",
  "configuration",
  "malformed",
  "malformed-response",
  "provider",
  "unavailable",
  "unsupported",
  "invalid-input",
] as const;
export type OperationalEvent = {
  provider: Provider;
  operation: Operation;
  status: (typeof reasons)[number];
  durationMs: number;
};
export type OperationalSink = (event: OperationalEvent) => void;
export function safeOperationalEvent(
  provider: Provider,
  operation: Operation,
  status: unknown,
  durationMs: number,
): OperationalEvent {
  return {
    provider: [
      "travelpayouts",
      "wikimedia",
      "pexels",
      "openai",
      "limiter",
    ].includes(provider)
      ? provider
      : "limiter",
    operation: [
      "flight-discovery",
      "location-search",
      "destination-metadata",
      "image-search",
      "affiliate-link",
      "intent",
      "explanations",
      "provider-admission",
      "rate-limit",
    ].includes(operation)
      ? operation
      : "rate-limit",
    status: reasons.includes(status as (typeof reasons)[number])
      ? (status as (typeof reasons)[number])
      : "provider",
    durationMs: Math.min(
      60000,
      Math.max(0, Math.round(Number.isFinite(durationMs) ? durationMs : 0)),
    ),
  };
}
/** Sink receives only the allowlist, never exceptions, context, URLs or raw responses. */
export function reportOperation(
  provider: Provider,
  operation: Operation,
  status: unknown,
  durationMs: number,
  sink?: OperationalSink,
) {
  const event = safeOperationalEvent(provider, operation, status, durationMs);
  try {
    if (sink) sink(event);
    else if (shouldLog("info", serverEnvironment().logLevel))
      console.info(JSON.stringify(event));
  } catch {}
}
export function reportDiagnostic(
  event: DiagnosticEvent,
  sink?: (value: DiagnosticEvent) => void,
) {
  try {
    const safe = safeDiagnosticEvent(event);
    if (sink) sink(safe);
    else if (shouldLog(safe.level, serverEnvironment().logLevel))
      // Errors and warnings go to their own streams so hosts surface them.
      (safe.level === "error"
        ? console.error
        : safe.level === "warn"
          ? console.warn
          : console.info)(JSON.stringify(safe));
  } catch {}
}
export function httpOperation(
  url: string,
  ttl: number,
): { provider: Provider; operation: Operation } {
  const u = new URL(url);
  if (u.hostname === "commons.wikimedia.org")
    return { provider: "wikimedia", operation: "image-search" };
  if (u.hostname === "api.pexels.com")
    return { provider: "pexels", operation: "image-search" };
  return {
    provider: "travelpayouts",
    operation: u.hostname.startsWith("autocomplete.")
      ? ttl >= 604800
        ? "destination-metadata"
        : "location-search"
      : "flight-discovery",
  };
}
