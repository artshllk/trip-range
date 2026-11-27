import "server-only";
import { redisCommand, type RedisConfiguration } from "./rate-limit";
import { reportDiagnostic } from "./observability";
import { localeFromPath } from "../i18n/routing";

/**
 * Per-client request limits (docs/abuse-controls.md, Option B). Runs in the proxy
 * before any page or route handler. A client is a keyed hash of its address with a
 * secret that changes every UTC day; the address itself is never stored or logged.
 *
 * Failure policy: anything that goes wrong (no address, no configuration, Redis
 * error, timeout, budget spent) lets the request through. The limiter must never
 * take down what it protects.
 */
export type ClientBucket = "plan" | "api" | "beacon";
export const clientLimits: Record<ClientBucket, number> = {
  plan: 60,
  api: 20,
  // Card-view beacons fire up to six per results page, so they get their own
  // counter instead of starving the flight-link and location calls under /api.
  beacon: 60,
};
export const CLIENT_WINDOW_MS = 60_000;
/** Above this many Redis calls a minute, an instance counts in memory instead. */
export const REDIS_CALLS_PER_MINUTE = 1000;
export const REDIS_TIMEOUT_MS = 150;
const MAX_ENTRIES = 10_000;

export function clientBucket(pathname: string): ClientBucket | undefined {
  if (pathname === "/api/affiliate/event") return "beacon";
  if (pathname.startsWith("/api/")) return "api";
  if (/^\/plan(?:\/|$)/.test(localeFromPath(pathname).path)) return "plan";
  return undefined;
}

function ipv4(value: string) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!m) return undefined;
  const octets = m.slice(1).map(Number);
  return octets.some((n) => n > 255) ? undefined : octets.join(".");
}

function ipv6Groups(value: string): number[] | undefined {
  if (value.length > 45 || !/^[0-9a-f:.]+$/i.test(value)) return undefined;
  let text = value;
  if (text.includes(".")) {
    // An IPv4 tail ("::ffff:192.0.2.1") becomes the last two groups.
    const at = text.lastIndexOf(":");
    const tail = ipv4(text.slice(at + 1));
    if (!tail) return undefined;
    const o = tail.split(".").map(Number);
    text = `${text.slice(0, at + 1)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const split = (s: string) => (s === "" ? [] : s.split(":"));
  const head = split(halves[0]);
  const tail = halves.length === 2 ? split(halves[1]) : [];
  const gap = 8 - head.length - tail.length;
  if (halves.length === 2 ? gap < 1 : gap !== 0) return undefined;
  const groups = [
    ...head,
    ...Array<string>(Math.max(0, gap)).fill("0"),
    ...tail,
  ];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g)))
    return undefined;
  return groups.map((g) => parseInt(g, 16));
}

/**
 * The client's address as the limiter keys it: an IPv4 address in full, an IPv6
 * address as its /64 prefix (one household or device usually holds a whole /64).
 *
 * Netlify appends the connecting address as the LAST x-forwarded-for entry; every
 * earlier entry is whatever the client sent. Verified on a deploy preview on
 * 25 November 2026 with 0, 1, 2, 3 and 10 spoofed entries: the real address was
 * last every time. x-nf-client-connection-ip does not reach the proxy.
 */
export function clientAddress(forwardedFor: string | null) {
  if (!forwardedFor) return undefined;
  const last = forwardedFor.slice(forwardedFor.lastIndexOf(",") + 1).trim();
  const four = ipv4(last);
  if (four) return four;
  const g = ipv6Groups(last);
  if (!g) return undefined;
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff)
    return [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join(".");
  return `${g
    .slice(0, 4)
    .map((n) => n.toString(16))
    .join(":")}::/64`;
}

const encoder = new TextEncoder();
let dayKey: { secret: string; day: string; key: CryptoKey } | undefined;
async function keyForDay(secret: string, day: string) {
  if (dayKey && dayKey.secret === secret && dayKey.day === day)
    return dayKey.key;
  const hmac = { name: "HMAC", hash: "SHA-256" } as const;
  const base = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    hmac,
    false,
    ["sign"],
  );
  const daily = await crypto.subtle.sign(
    "HMAC",
    base,
    encoder.encode(`trip-range:client-limit:${day}`),
  );
  const key = await crypto.subtle.importKey("raw", daily, hmac, false, [
    "sign",
  ]);
  dayKey = { secret, day, key };
  return key;
}

/** A short code for one client on one UTC day. Not reversible without the secret. */
export async function clientCode(address: string, secret: string, now: Date) {
  const key = await keyForDay(secret, now.toISOString().slice(0, 10));
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(address)),
  );
  return btoa(String.fromCharCode(...mac.subarray(0, 12)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export type ClientDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

type Note =
  | "refused"
  | "fail-open"
  | "budget-exceeded"
  | "no-client-address"
  | "no-secret"
  | "no-database";

/** One log line per kind per minute per instance, with a count. Never an identifier. */
function throttledReporter(now: () => number) {
  const seen = new Map<Note, { minute: number; count: number }>();
  return (note: Note) => {
    const minute = Math.floor(now() / CLIENT_WINDOW_MS);
    const entry = seen.get(note);
    if (entry && entry.minute === minute) {
      entry.count++;
      return;
    }
    const previous = entry?.count ?? 0;
    seen.set(note, { minute, count: 1 });
    reportDiagnostic({
      level: note === "refused" ? "info" : "warn",
      component: "limiter",
      operation: "client-limit",
      status: note,
      // How many of these the previous reported minute saw on this instance.
      ...(previous ? { count: previous } : {}),
    });
  };
}

export type ClientLimiterOptions = {
  redis: RedisConfiguration;
  namespace: string;
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  redisCallsPerMinute?: number;
  maxEntries?: number;
  report?: (note: Note) => void;
};

export function createClientLimiter(options: ClientLimiterOptions) {
  const now = options.now ?? Date.now;
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? REDIS_TIMEOUT_MS;
  const budget = options.redisCallsPerMinute ?? REDIS_CALLS_PER_MINUTE;
  const maxEntries = options.maxEntries ?? MAX_ENTRIES;
  const report = options.report ?? throttledReporter(now);
  // Clients already over the limit this window: refused without calling Redis.
  const denied = new Set<string>();
  // Counts kept in memory once this instance has spent its Redis budget.
  const local = new Map<string, number>();
  // Keys whose expiry could not be set; retried on the client's next request.
  const unexpired = new Set<string>();
  let window = -1;
  let calls = 0;

  async function expire(key: string) {
    const reply = await redisCommand(
      options.redis,
      ["PEXPIRE", key, String(CLIENT_WINDOW_MS)],
      fetcher,
      timeoutMs,
    );
    if (reply.ok && reply.result === 1) unexpired.delete(key);
    else if (unexpired.size < maxEntries) unexpired.add(key);
  }

  return {
    async check(bucket: ClientBucket, code: string): Promise<ClientDecision> {
      const time = now();
      const current = Math.floor(time / CLIENT_WINDOW_MS);
      if (current !== window) {
        window = current;
        calls = 0;
        denied.clear();
        local.clear();
      }
      const refuse = (): ClientDecision => {
        report("refused");
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil(((current + 1) * CLIENT_WINDOW_MS - time) / 1000),
          ),
        };
      };
      const id = `${bucket}:${code}`;
      if (denied.has(id)) return refuse();
      const limit = clientLimits[bucket];

      if (calls >= budget) {
        report("budget-exceeded");
        if (!local.has(id) && local.size >= maxEntries)
          return { allowed: true };
        const n = (local.get(id) ?? 0) + 1;
        local.set(id, n);
        return n > limit ? refuse() : { allowed: true };
      }

      calls++;
      const key = `${options.namespace}:client:${bucket}:${current}:${code}`;
      const reply = await redisCommand(
        options.redis,
        ["INCR", key],
        fetcher,
        timeoutMs,
      );
      if (
        !reply.ok ||
        typeof reply.result !== "number" ||
        !Number.isInteger(reply.result)
      ) {
        report("fail-open");
        return { allowed: true };
      }
      // The counter expires 60 seconds after the client's first request in the
      // window. Only the first increment pays for the second command.
      if (reply.result === 1 || unexpired.has(key)) {
        calls++;
        await expire(key);
      }
      if (reply.result > limit) {
        if (denied.size < maxEntries) denied.add(id);
        return refuse();
      }
      return { allowed: true };
    },
  };
}

const disabledReporter = throttledReporter(Date.now);
let cached:
  | { identity: string; limiter: ReturnType<typeof createClientLimiter> }
  | undefined;

/**
 * The proxy's entry point: a 429 response when this client is over its limit,
 * otherwise undefined (carry on). Never throws.
 */
export async function refuseOverLimit(
  pathname: string,
  headers: Headers,
  env: {
    clientLimit?: { redis: RedisConfiguration; secret: string };
    redis?: RedisConfiguration;
    limiterNamespace: string;
  },
  now = new Date(),
): Promise<Response | undefined> {
  try {
    const bucket = clientBucket(pathname);
    if (!bucket) return undefined;
    if (!env.clientLimit) {
      // Say why it is off: a missing or invalid CLIENT_LIMIT_SECRET, or no
      // limiter database (RATE_LIMIT_REDIS_REST_*) in this deploy context.
      disabledReporter(env.redis ? "no-secret" : "no-database");
      return undefined;
    }
    const address = clientAddress(headers.get("x-forwarded-for"));
    if (!address) {
      disabledReporter("no-client-address");
      return undefined;
    }
    const identity = JSON.stringify([env.clientLimit, env.limiterNamespace]);
    if (!cached || cached.identity !== identity)
      cached = {
        identity,
        limiter: createClientLimiter({
          redis: env.clientLimit.redis,
          namespace: env.limiterNamespace,
        }),
      };
    const code = await clientCode(address, env.clientLimit.secret, now);
    const decision = await cached.limiter.check(bucket, code);
    if (decision.allowed) return undefined;
    const headersOut = {
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
      "Retry-After": String(decision.retryAfterSeconds),
    };
    return bucket === "plan"
      ? new Response(
          "Too many requests from your connection. Please wait a minute and try again.\n",
          {
            status: 429,
            headers: {
              ...headersOut,
              "Content-Type": "text/plain; charset=utf-8",
            },
          },
        )
      : Response.json(
          { status: "rate-limited" },
          { status: 429, headers: headersOut },
        );
  } catch {
    return undefined;
  }
}
