import "server-only";
import { performance } from "node:perf_hooks";
import {
  admitProviderAttempt,
  PROVIDER_ADMISSION_TIMEOUT_MS,
  type ProviderAdmission,
} from "./provider-admission";
import {
  ProviderRequestError,
  type ProviderFetch,
} from "../providers/server/http";

/** Each collector page competes with live searches in the same Redis window.
 * Denials, ambiguous admissions and outages stop the page before provider I/O.
 * Never retry/refund an admission: Redis may already have recorded it.
 */
export function collectorHttp(
  token: string,
  fetcher: ProviderFetch = fetch,
  admission: ProviderAdmission = admitProviderAttempt,
): (url: URL, signal?: AbortSignal) => Promise<Response> {
  return async (url, callerSignal) => {
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000);
    if (signal.aborted) throw new ProviderRequestError("timeout");
    const start = performance.now();
    const decision = await admission(signal, url.toString());
    if (
      signal.aborted ||
      decision === "timeout" ||
      performance.now() - start >= PROVIDER_ADMISSION_TIMEOUT_MS
    )
      throw new ProviderRequestError("timeout");
    if (decision !== "allowed")
      throw new ProviderRequestError(
        decision === "quota" ? "rate-limit" : "admission-unavailable",
      );
    return fetcher(url.toString(), {
      headers: { "X-Access-Token": token },
      signal,
      redirect: "error",
      cache: "no-store",
    });
  };
}
