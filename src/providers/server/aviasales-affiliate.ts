import { reportOperation } from "../../server/observability";
import "server-only";
import type { FlightAffiliateProvider } from "../contracts";
import {
  readFlightHandoff,
  type FlightHandoff,
  type AffiliateResult,
} from "../../domain/affiliate";
import { nightsBetween } from "../../domain/dates";
import { record, type ProviderFetch } from "./http";
import type { AffiliateEnvironment } from "./environment";

import {
  equivalentAviasalesSearch,
  validatePartnerUrl,
  type PartnerValidation,
} from "./affiliate-url";
export { safePartnerUrl } from "./affiliate-url";

export type AffiliateDiagnostic = {
  httpStatus: number;
  providerCode: string | null;
  providerStatus: number | null;
  linkCode: string | null;
  validationReason: PartnerValidation["reason"];
  partnerLinkHost: PartnerValidation["partnerLinkHost"];
  partnerPathShape: PartnerValidation["partnerPathShape"];
};
// Provider strings are untrusted, even in fields named "code". Never forward free text.
function diagnosticCode(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return "unrecognized";
  return [
    "success",
    "failed",
    "incorrect_request_body",
    "unauthorized",
    "error",
    "too_many_requests",
  ].includes(String(value))
    ? String(value)
    : "unrecognized";
}

/** Official DDMM compact search format. Reject dates whose year would be ambiguous. */
export function aviasalesSearchUrl(
  input: FlightHandoff,
  today: string,
): string | undefined {
  const route = readFlightHandoff(input);
  if (
    !route ||
    route.departureDate < today ||
    nightsBetween(today, route.departureDate) >= 365
  )
    return;
  const ddmm = (date: string) => date.slice(8, 10) + date.slice(5, 7);
  return `https://www.aviasales.com/search/${route.originCode}${ddmm(route.departureDate)}${route.destinationCode}${ddmm(route.returnDate)}${route.party.adults}${route.party.children || ""}`;
}
export function affiliateConfigured(env: AffiliateEnvironment) {
  return (
    !!env.TRAVELPAYOUTS_API_TOKEN?.trim() &&
    [env.TRAVELPAYOUTS_PROJECT_ID, env.TRAVELPAYOUTS_MARKER].every(
      (v) =>
        typeof v === "string" &&
        /^[1-9]\d{0,14}$/.test(v) &&
        Number.isSafeInteger(Number(v)),
    )
  );
}
export function createAviasalesAffiliate(
  env: AffiliateEnvironment,
  fetcher: ProviderFetch = fetch,
  today = () => new Date().toISOString().slice(0, 10),
  timeoutMs = 3000,
  onDiagnostic?: (event: AffiliateDiagnostic) => void,
): FlightAffiliateProvider {
  return {
    async createLink(route, placement) {
      const started = Date.now();
      if (!affiliateConfigured(env))
        return { status: "unavailable", reason: "configuration" };
      const url = aviasalesSearchUrl(route, today());
      if (!url || !["results", "trip"].includes(placement))
        return { status: "unavailable", reason: "unsupported" };
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<AffiliateResult>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ status: "unavailable", reason: "timeout" });
        }, timeoutMs);
      });
      const request = (async (): Promise<AffiliateResult> => {
        try {
          const response = await fetcher(
            "https://api.travelpayouts.com/links/v1/create",
            {
              method: "POST",
              redirect: "error",
              cache: "no-store",
              signal: controller.signal,
              headers: {
                "Content-Type": "application/json",
                "X-Access-Token": env.TRAVELPAYOUTS_API_TOKEN!.trim(),
              },
              body: JSON.stringify({
                trs: Number(env.TRAVELPAYOUTS_PROJECT_ID),
                marker: Number(env.TRAVELPAYOUTS_MARKER),
                shorten: true,
                links: [{ url, sub_id: `${placement}_flight` }],
              }),
            },
          );
          function report(data?: unknown, validation?: PartnerValidation) {
            const result =
              record(data) && record(data.result) ? data.result : undefined;
            const link =
              result &&
              Array.isArray(result.links) &&
              result.links.length === 1 &&
              record(result.links[0])
                ? result.links[0]
                : undefined;
            try {
              onDiagnostic?.({
                httpStatus: response.status,
                providerCode: record(data) ? diagnosticCode(data.code) : null,
                providerStatus:
                  record(data) &&
                  typeof data.status === "number" &&
                  Number.isInteger(data.status) &&
                  data.status >= 100 &&
                  data.status <= 599
                    ? data.status
                    : null,
                linkCode: link ? diagnosticCode(link.code) : null,
                validationReason: validation?.reason ?? null,
                partnerLinkHost: validation?.partnerLinkHost ?? null,
                partnerPathShape: validation?.partnerPathShape ?? null,
              });
            } catch {
              /* Diagnostics must not change handoff behavior. */
            }
          }
          report();
          const httpFailure: AffiliateResult | undefined = !response.ok
            ? {
                status: "unavailable",
                reason:
                  response.status === 429
                    ? "rate-limit"
                    : [401, 403].includes(response.status)
                      ? "authentication"
                      : "provider",
              }
            : undefined;
          // Normal production failures keep their fast path; the local diagnostic can inspect a bounded body.
          if (httpFailure && !onDiagnostic) return httpFailure;
          const reader = response.body?.getReader();
          if (!reader)
            return (
              httpFailure ?? { status: "unavailable", reason: "malformed" }
            );
          let size = 0,
            text = "";
          const decoder = new TextDecoder();
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > 65536) {
              await reader.cancel();
              return (
                httpFailure ?? { status: "unavailable", reason: "malformed" }
              );
            }
            text += decoder.decode(part.value, { stream: true });
          }
          let data: unknown;
          try {
            data = JSON.parse(text + decoder.decode());
          } catch {
            return (
              httpFailure ?? { status: "unavailable", reason: "malformed" }
            );
          }
          report(data);
          if (httpFailure) return httpFailure;
          const result =
            record(data) && record(data.result) ? data.result : undefined;
          const link =
            result && Array.isArray(result.links) && result.links.length === 1
              ? result.links[0]
              : undefined;
          if (
            !record(data) ||
            data.code !== "success" ||
            data.status !== 200 ||
            !record(link) ||
            link.code !== "success"
          )
            return { status: "unavailable", reason: "malformed" };
          const validation = validatePartnerUrl(
            link.partner_url,
            env,
            url,
            placement,
          );
          if (!equivalentAviasalesSearch(link.url, url)) {
            report(data, {
              ...validation,
              reason: "original URL normalization mismatch",
            });
            return { status: "unavailable", reason: "malformed" };
          }
          report(data, validation);
          if (validation.reason || typeof link.partner_url !== "string")
            return { status: "unavailable", reason: "malformed" };
          return {
            status: "available",
            link: { provider: "aviasales", url: link.partner_url },
          };
        } catch {
          return {
            status: "unavailable",
            reason: controller.signal.aborted ? "timeout" : "provider",
          };
        }
      })();
      try {
        const result = await Promise.race([request, timeout]);
        if (result.status === "unavailable") {
          reportOperation(
            "travelpayouts",
            "affiliate-link",
            result.reason,
            Date.now() - started,
          );
        }
        return result;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
