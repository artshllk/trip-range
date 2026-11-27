import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

// Reuse the existing diagnostic compilation, not a second limiter implementation.
// A direct invocation without compiled output fails closed. The npm command
// compiles this module's dependency and enables its server-only import condition.
export function diagnosticAdmission(
  redis,
  fetcher = fetch,
  loadShared = () => import("../.seo-build/src/server/provider-admission.js"),
) {
  return async (signal, target) => {
    if (signal.aborted) return "timeout";
    if (!redis?.url || !redis?.token) return "unavailable";
    try {
      const { redisProviderAdmission } = await loadShared();
      return await redisProviderAdmission(redis, fetcher)(signal, target);
    } catch {
      return signal.aborted ? "timeout" : "unavailable";
    }
  };
}

const endpoint = "https://api.travelpayouts.com/aviasales/v3/prices_for_dates";
const date = (value) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)
    ? value.slice(0, 10)
    : null;
const airport = (value) =>
  typeof value === "string" && /^[A-Z]{3}$/.test(value) ? value : null;

// Never return upstream messages, headers, URLs, or thrown error text.
export async function checkOrigin(
  token,
  origin,
  fetcher = fetch,
  now = new Date(),
  timeoutMs = 4000,
  mode = "exact",
  admission = diagnosticAdmission({
    url: process.env.RATE_LIMIT_REDIS_REST_URL?.trim(),
    token: process.env.RATE_LIMIT_REDIS_REST_TOKEN?.trim(),
  }),
) {
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() + 30);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 3);
  const dates = {
    departure: start.toISOString().slice(0, 10),
    return: end.toISOString().slice(0, 10),
  };
  const report = {
    origin,
    mode,
    authentication: "not confirmed",
    httpStatus: null,
    providerStatus: "unavailable",
    faresReturned: 0,
    destinationAirports: [],
    dates,
    fareDates: [],
    failureReason: null,
  };
  const url = new URL(endpoint);
  url.search = new URLSearchParams({
    origin,
    departure_at:
      mode === "month" ? dates.departure.slice(0, 7) : dates.departure,
    return_at: mode === "month" ? dates.return.slice(0, 7) : dates.return,
    one_way: "false",
    currency: "eur",
    sorting: "price",
    unique: mode === "month" ? "false" : "true",
    limit: "5",
    page: "1",
    market: "us",
  }).toString();
  const controller = new AbortController();
  const deadline = performance.now() + Math.min(timeoutMs, 4000);
  const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 4000));
  try {
    const decision = await admission(controller.signal, url.toString());
    if (
      controller.signal.aborted ||
      performance.now() >= deadline ||
      decision === "timeout"
    ) {
      report.failureReason = "timeout";
      return report;
    }
    if (decision !== "allowed") {
      report.failureReason =
        decision === "quota" ? "rate-limit" : "provider-admission-unavailable";
      return report;
    }
    const response = await fetcher(url, {
      headers: { "X-Access-Token": token },
      signal: controller.signal,
      redirect: "error",
      cache: "no-store",
    });
    report.httpStatus = response.status;
    if (!response.ok) {
      report.authentication = [401, 403].includes(response.status)
        ? "failed"
        : "not confirmed";
      report.failureReason = [401, 403].includes(response.status)
        ? "authentication-failed"
        : response.status === 429
          ? "rate-limit"
          : "http-error";
      await response.body?.cancel();
      return report;
    }
    const reader = response.body?.getReader();
    if (!reader) {
      report.failureReason = "empty-response";
      return report;
    }
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 128_000) {
        await reader.cancel();
        report.failureReason = "response-too-large";
        return report;
      }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || body.success !== true || !Array.isArray(body.data)) {
      report.providerStatus = body?.success === false ? "failed" : "malformed";
      report.failureReason =
        body?.success === false
          ? "provider-rejected-request"
          : "malformed-response";
      return report;
    }
    report.authentication = "OK";
    report.providerStatus = "success";
    report.faresReturned = body.data.length;
    report.destinationAirports = [
      ...new Set(
        body.data
          .slice(0, 5)
          .flatMap((row) =>
            [
              airport(row?.destination_airport) ?? airport(row?.destination),
            ].filter(Boolean),
          ),
      ),
    ];
    report.fareDates = body.data.slice(0, 5).map((row) => ({
      departure: date(row?.departure_at),
      return: date(row?.return_at),
    }));
    return report;
  } catch {
    report.failureReason = controller.signal.aborted
      ? "timeout"
      : report.httpStatus === null
        ? "network-error"
        : "malformed-response";
    return report;
  } finally {
    clearTimeout(timer);
  }
}

export async function main() {
  let local;
  let token;
  try {
    local = parseEnv(
      await readFile(new URL("../.env.local", import.meta.url), "utf8"),
    );
    token = local.TRAVELPAYOUTS_API_TOKEN?.trim();
  } catch {
    console.log(
      "Travelpayouts: authentication not checked; .env.local missing or unreadable.",
    );
    process.exitCode = 1;
    return;
  }
  const admission = diagnosticAdmission({
    url: (
      process.env.RATE_LIMIT_REDIS_REST_URL ?? local.RATE_LIMIT_REDIS_REST_URL
    )?.trim(),
    token: (
      process.env.RATE_LIMIT_REDIS_REST_TOKEN ??
      local.RATE_LIMIT_REDIS_REST_TOKEN
    )?.trim(),
  });
  if (!token) {
    console.log(
      "Travelpayouts: authentication not checked; TRAVELPAYOUTS_API_TOKEN missing in .env.local.",
    );
    process.exitCode = 1;
    return;
  }
  // Keep stdout restricted to the existing sanitized diagnostic reports.
  process.env.GOEKSPLO_LOG_LEVEL = "off";
  for (const origin of ["PRN", "ZRH"]) {
    for (const mode of process.argv.includes("--both")
      ? ["exact", "month"]
      : [process.argv.includes("--month") ? "month" : "exact"]) {
      const report = await checkOrigin(
        token,
        origin,
        fetch,
        new Date(),
        4000,
        mode,
        admission,
      );
      // Defense in depth even if a provider echoes a credential in a shaped field.
      console.log(JSON.stringify(report).split(token).join("[redacted]"));
      if (report.failureReason) process.exitCode = 1;
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
