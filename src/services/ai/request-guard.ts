import { matchesRequestOrigin } from "../../server/request-origin";
import { boundedJson } from "../../server/request-body";
/** A coarse process-local ceiling; no IP, prompt or identity retention. */
let windowStart = 0,
  count = 0,
  active = 0;
export function acquireAiSlot(now = Date.now()): (() => void) | undefined {
  if (now - windowStart >= 60000) {
    windowStart = now;
    count = 0;
  }
  if (count >= 20 || active >= 4) return;
  count++;
  active++;
  return () => {
    active = Math.max(0, active - 1);
  };
}
export async function readAiBody(request: Request): Promise<unknown> {
  if (
    request.method !== "POST" ||
    !matchesRequestOrigin(request, request.headers.get("origin") ?? "") ||
    ![null, "same-origin"].includes(request.headers.get("sec-fetch-site")) ||
    request.headers.get("content-type")?.split(";")[0] !== "application/json" ||
    Number(request.headers.get("content-length")) > 8192
  )
    return;
  return boundedJson(request, 8192);
}
