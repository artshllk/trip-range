import "server-only";
import { object } from "../../domain/media/validation";
export type MediaService = "wikidata" | "commons";
export type MediaApiFailure = {
  service: MediaService;
  reason:
    | "rate-limit"
    | "timeout"
    | "network"
    | "provider-unavailable"
    | "malformed-response"
    | "oversized-response"
    | "request-budget-exhausted";
  httpStatus: number | null;
};
export interface MediaApi {
  get(
    service: MediaService,
    params: Record<string, string>,
  ): Promise<Record<string, unknown>>;
}
export const MEDIA_REQUEST_LIMITS = {
  wikidata: 10,
  commons: 4,
  total: 14,
  timeoutMs: 3000,
  deadlineMs: 30000,
  bytes: 2_000_000,
} as const;
// Wikimedia's User-Agent policy asks for a working contact. hello@trip-range.com must
// receive mail before launch; the site URL answers 401 until then (launch checklist).
export const MEDIA_USER_AGENT =
  "TripRangeMediaReview/1.0 (https://www.trip-range.com; hello@trip-range.com; operator-initiated destination media discovery)";
const endpoints: Record<MediaService, string> = {
  wikidata: "https://www.wikidata.org/w/api.php",
  commons: "https://commons.wikimedia.org/w/api.php",
};
/** Fixed endpoints only. No remote URL is ever passed to fetch. No credentials or environment reads. */
export function createMediaApi(
  fetcher: typeof fetch = fetch,
  timeoutMs: number = MEDIA_REQUEST_LIMITS.timeoutMs,
) {
  const counts = { wikidata: 0, commons: 0 },
    started = Date.now();
  const failures: MediaApiFailure[] = [];
  const api: MediaApi = {
    async get(service, params) {
      if (
        !Object.prototype.hasOwnProperty.call(endpoints, service) ||
        !["query", "wbsearchentities", "wbgetentities"].includes(
          params.action,
        ) ||
        Object.values(params).some((v) => v.length > 5000)
      )
        throw Error("invalid-request");
      // A rate-limited batch must stop, even if a caller catches the safe error.
      if (failures.some((f) => f.reason === "rate-limit"))
        throw Error("media-metadata-unavailable");
      if (
        counts[service] >= MEDIA_REQUEST_LIMITS[service] ||
        counts.wikidata + counts.commons >= MEDIA_REQUEST_LIMITS.total ||
        Date.now() - started >= MEDIA_REQUEST_LIMITS.deadlineMs
      ) {
        failures.push({
          service,
          reason: "request-budget-exhausted",
          httpStatus: null,
        });
        throw Error("request-budget-exhausted");
      }
      const url = new URL(endpoints[service]);
      url.search = new URLSearchParams({
        ...params,
        format: "json",
        formatversion: "2",
        maxlag: "5",
      }).toString();
      counts[service]++;
      let reason: MediaApiFailure["reason"] = "network";
      let httpStatus: number | null = null;
      const controller = new AbortController();
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let timer: ReturnType<typeof setTimeout>;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => {
            reason = "timeout";
            controller.abort();
            reject(Error("timeout"));
          },
          Math.min(
            timeoutMs,
            MEDIA_REQUEST_LIMITS.deadlineMs - (Date.now() - started),
          ),
        );
      });
      try {
        return await Promise.race([
          timeout,
          (async () => {
            const response = await fetcher(url, {
              signal: controller.signal,
              redirect: "error",
              cache: "no-store",
              headers: {
                "User-Agent": MEDIA_USER_AGENT,
                Accept: "application/json",
              },
            });
            httpStatus = response.status;
            if (!response.ok) {
              reason =
                response.status === 429 ? "rate-limit" : "provider-unavailable";
              throw Error("http-failure");
            }
            if (
              Number(response.headers.get("content-length")) >
              MEDIA_REQUEST_LIMITS.bytes
            ) {
              reason = "oversized-response";
              throw Error("oversized-response");
            }
            reader = response.body?.getReader();
            if (!reader) {
              reason = "malformed-response";
              throw Error("malformed-response");
            }
            let length = 0,
              body = "";
            const decoder = new TextDecoder();
            while (true) {
              const item = await reader.read();
              if (item.done) break;
              length += item.value.byteLength;
              if (length > MEDIA_REQUEST_LIMITS.bytes) {
                reason = "oversized-response";
                throw Error("oversized-response");
              }
              body += decoder.decode(item.value, { stream: true });
            }
            reason = "malformed-response";
            const value: unknown = JSON.parse(body + decoder.decode());
            if (
              object(value) &&
              object(value.error) &&
              ["ratelimited", "maxlag"].includes(String(value.error.code))
            ) {
              reason = "rate-limit";
              throw Error("rate-limit");
            }
            if (!object(value) || value.error || value.success === 0)
              throw Error("malformed-response");
            return value;
          })(),
        ]);
      } catch {
        failures.push({ service, reason, httpStatus });
        throw Error("media-metadata-unavailable");
      } finally {
        clearTimeout(timer!);
        controller.abort();
        void reader?.cancel().catch(() => {});
      }
    },
  };
  return { api, counts, failures };
}
