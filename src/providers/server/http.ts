import { httpOperation, reportOperation } from "../../server/observability";
import "server-only";
export type ProviderFailure =
  | "timeout"
  | "rate-limit"
  | "admission-unavailable"
  | "authentication"
  | "unavailable"
  | "malformed-response";
export type ProviderFetchOptions = RequestInit & {
  next?: { revalidate: number; tags?: string[] };
};
export type ProviderFetch = (
  url: string,
  options: ProviderFetchOptions,
) => Promise<Response>;
export type HttpResult =
  | {
      ok: true;
      body: unknown;
      responseDate: string | null;
      /** Our clock when the provider call completed. Set inside the cache loader, so cache hits keep it. */
      fetchedAt?: string;
    }
  | { ok: false; reason: ProviderFailure };
/** Safe typed control flow; never includes URLs, credentials or upstream bodies. */
export class ProviderRequestError extends Error {
  constructor(readonly reason: ProviderFailure) {
    super("Provider request unavailable");
  }
}
export const systemClock = () => new Date();
export function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function timestamp(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}
/** Next's persistent Data Cache is keyed by this exact URL + request options, including private auth headers. */
export async function providerJson(
  url: string,
  headers: Record<string, string>,
  ttl: number,
  fetcher: ProviderFetch = fetch,
  timeoutMs = 4000,
  cache = true,
): Promise<HttpResult> {
  const started = Date.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<HttpResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, reason: "timeout" });
    }, timeoutMs);
  });
  const request = (async (): Promise<HttpResult> => {
    try {
      const response = await fetcher(url, {
        headers,
        signal: controller.signal,
        cache: cache ? "force-cache" : "no-store",
        ...(cache ? { next: { revalidate: ttl } } : {}),
        redirect: "error",
      });
      if (!response.ok)
        return {
          ok: false,
          reason:
            response.status === 429
              ? "rate-limit"
              : [401, 403].includes(response.status)
                ? "authentication"
                : "unavailable",
        };
      if (Number(response.headers.get("content-length")) > 2_000_000)
        return { ok: false, reason: "malformed-response" };
      let body: unknown;
      try {
        const reader = response.body?.getReader();
        if (!reader) return { ok: false, reason: "malformed-response" };
        let size = 0;
        let text = "";
        const decoder = new TextDecoder();
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 2_000_000) {
            await reader.cancel();
            return { ok: false, reason: "malformed-response" };
          }
          text += decoder.decode(chunk.value, { stream: true });
        }
        body = JSON.parse(text + decoder.decode());
      } catch {
        return { ok: false, reason: "malformed-response" };
      }
      return {
        ok: true,
        body,
        responseDate: timestamp(response.headers.get("date")),
      };
    } catch (error) {
      return {
        ok: false,
        reason: controller.signal.aborted
          ? "timeout"
          : error instanceof ProviderRequestError
            ? error.reason
            : "unavailable",
      };
    }
  })();
  try {
    const result = await Promise.race([request, timeout]);
    const op = httpOperation(url, ttl);
    reportOperation(
      op.provider,
      op.operation,
      result.ok ? "success" : result.reason,
      Date.now() - started,
    );
    return result;
  } finally {
    clearTimeout(timer);
  }
}
