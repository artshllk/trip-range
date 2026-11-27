import { getTripTemplates } from "../src/services/travel";
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  getAppTripTemplates,
  getDemoImageTemplates,
} from "../src/services/app-travel";
import { createEditorialImages } from "../src/providers/server/editorial-images";
import { demoProviders } from "../src/providers/demo";
import { defaultRequest } from "./fixtures/prishtina-request";
import { pricePlan } from "../src/domain/pricing";
import { appExplanations } from "../src/services/ai/app-explanations";
import { allowOperation, limits, localLimiter } from "../src/server/rate-limit";

const nextCache = createRequire(__filename)(
  "next/cache",
) as typeof import("next/cache");
const ids = ["prizren", "ohrid"];
const env = {
  VERCEL: "1",
  VERCEL_ENV: "production",
  NODE_ENV: "production",
  RATE_LIMIT_REDIS_REST_URL: "https://editorial-test.upstash.io",
  RATE_LIMIT_REDIS_REST_TOKEN: "synthetic-editorial-test",
  TRAVELPAYOUTS_API_TOKEN: "synthetic-unused-flight-token",
  PEXELS_API_KEY: "",
  OPENAI_API_KEY: "synthetic-unused-ai-key",
  OPENAI_MODEL: "test-model",
  GOEKSPLO_LOG_LEVEL: "off",
};
let fixtureId = 0;

function setup(t: TestContext, patch: Partial<typeof env> = {}) {
  const old = new Map(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(
    process.env,
    env,
    {
      RATE_LIMIT_REDIS_REST_URL: `https://editorial-test-${++fixtureId}.upstash.io`,
    },
    patch,
  );
  t.after(() => {
    for (const [key, value] of old)
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
  // Detect any accidental return to the old selected-image cache on editorial views.
  const entries = new Map<string, Promise<unknown>>();
  t.mock.method(
    nextCache,
    "unstable_cache",
    (
      callback: () => Promise<unknown>,
      keys: string[],
      options: { revalidate: number },
    ) => {
      assert.equal(options.revalidate, 86400);
      return () => {
        const key = JSON.stringify(keys);
        if (!entries.has(key)) entries.set(key, callback());
        return entries.get(key);
      };
    },
  );
  const operations: string[] = [];
  const imageCalls: string[] = [];
  let redisDown = false;
  let imagesFail = false;
  let deny = false;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, options?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname.endsWith(".upstash.io")) {
        const command = JSON.parse(String(options?.body));
        operations.push(command[3].split(":").at(-1));
        return redisDown
          ? new Response(null, { status: 503 })
          : Response.json({ result: deny ? 0 : 1 });
      }
      assert.ok(
        ["commons.wikimedia.org", "api.pexels.com"].includes(url.hostname),
        "no flight, location, AI or affiliate provider call",
      );
      imageCalls.push(url.hostname);
      if (imagesFail) return new Response(null, { status: 503 });
      const query = url.searchParams.get("gsrsearch") ?? "";
      return Response.json({
        query: {
          pages: [
            {
              pageid: 987,
              ns: 6,
              title: `File:${query}.jpg`,
              imageinfo: [
                {
                  url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Editorial.jpg",
                  descriptionurl:
                    "https://commons.wikimedia.org/wiki/File:Editorial.jpg",
                  width: 2400,
                  height: 1600,
                  size: 12345,
                  mime: "image/jpeg",
                  mediatype: "BITMAP",
                  extmetadata: {
                    Artist: { value: "Editorial photographer" },
                    LicenseShortName: { value: "CC BY-SA 4.0" },
                    LicenseUrl: {
                      value: "https://creativecommons.org/licenses/by-sa/4.0/",
                    },
                    ImageDescription: { value: query },
                    Credit: { value: "Own work" },
                  },
                },
              ],
            },
          ],
        },
      });
    },
  );
  return {
    operations,
    imageCalls,
    entries,
    redisFailure: () => {
      redisDown = true;
    },
    imageFailure: () => {
      imagesFail = true;
    },
    deny: () => {
      deny = true;
    },
  };
}

test("editorial views read stored images without discovery, AI or any quota in EN/SQ-style repeat reads", async (t) => {
  const state = setup(t, { PEXELS_API_KEY: "synthetic-pexels-key" });
  const first = await getDemoImageTemplates(defaultRequest, ids);
  assert.deepEqual(
    first.templates.map((p) => p.id),
    ids,
  );
  assert.deepEqual(state.operations, []);
  assert.deepEqual(state.imageCalls, []);
  assert.ok(
    first.templates.every((p) => p.destination.image?.source !== "provider"),
  );
  assert.deepEqual(await getDemoImageTemplates(defaultRequest, ids), first);
  assert.equal(
    state.entries.size,
    0,
    "editorial views do not read old selected-image caches",
  );
  // Historical engine fixture still guards against invented airfare; parked Crete
  // is excluded from the production editorial list above.
  const historical = await getTripTemplates(
    defaultRequest,
    demoProviders,
    "crete",
  );
  const crete = pricePlan(historical.templates[0], defaultRequest);
  assert.equal(crete.pricingCompleteness, "flight-unpriced");
  assert.equal(crete.budget, undefined);
  assert.deepEqual(
    await appExplanations(
      false,
      first.templates.map((p) => pricePlan(p, defaultRequest)),
      "en",
    ),
    {},
  );
  assert.deepEqual(state.operations, []);
  assert.deepEqual(state.imageCalls, []);
});

test("editorial image-provider failures cannot affect page content or trigger retries", async (t) => {
  const state = setup(t, { PEXELS_API_KEY: "synthetic-pexels-key" });
  state.imageFailure();
  const result = await getDemoImageTemplates(defaultRequest, ids);
  assert.equal(result.templates.length, 2);
  await getDemoImageTemplates(defaultRequest, ids);
  assert.deepEqual(state.operations, []);
  assert.deepEqual(state.imageCalls, []);
});

test("legacy verified flags cannot bypass the source-controlled approval store", async (t) => {
  const state = setup(t);
  const d = (await demoProviders.destinations.list())[0];
  const local = {
    ...d,
    image: {
      ...d.image!,
      source: "local" as const,
      src: "/destinations/reviewed.jpg",
      verification: "verified" as const,
    },
  };
  assert.deepEqual(
    await createEditorialImages([local]).forDestination(local.id),
    undefined,
  );
  assert.deepEqual(state.operations, []);
  assert.deepEqual(state.imageCalls, []);
});

test("production without Redis keeps editorial content safe and all real operations fail closed", async (t) => {
  const state = setup(t, {
    RATE_LIMIT_REDIS_REST_URL: "",
    RATE_LIMIT_REDIS_REST_TOKEN: "",
  });
  const home = await getDemoImageTemplates(defaultRequest, ids);
  assert.equal(home.templates.length, 2);
  assert.ok(
    home.templates.every((p) => p.destination.image?.source !== "provider"),
  );
  const search = await getAppTripTemplates(defaultRequest);
  assert.ok(
    search.issues.some(
      (i) =>
        i.destinationId === "flight-discovery" &&
        i.source.status !== "available" &&
        i.source.reason === "rate-limit",
    ),
  );
  for (const operation of [
    "ai-intent",
    "ai-explanations",
    "affiliate",
    "locations",
  ] as const)
    assert.equal(await allowOperation(operation), false);
  assert.deepEqual(state.operations, []);
  assert.deepEqual(state.imageCalls, []);
});

test("stored editorial image reads neither depend on Redis nor bypass protection for user operations", async (t) => {
  const state = setup(t);
  const first = await getDemoImageTemplates(defaultRequest, ids);
  state.redisFailure();
  assert.deepEqual(await getDemoImageTemplates(defaultRequest, ids), first);
  assert.deepEqual(state.operations, []);
  assert.deepEqual(state.imageCalls, []);
  assert.equal(await allowOperation("affiliate"), false);
  assert.deepEqual(state.operations, ["affiliate"]);
});

test("real structured search still uses the search gate and never calls AI", async (t) => {
  const state = setup(t);
  state.deny();
  const result = await getAppTripTemplates(defaultRequest);
  assert.deepEqual(state.operations, ["search"]);
  assert.deepEqual(state.imageCalls, []);
  assert.ok(
    result.issues.some(
      (i) =>
        i.source.status !== "available" && i.source.reason === "rate-limit",
    ),
  );
});

test("exhausted editorial-image capacity cannot consume protected user-operation buckets", async () => {
  const limiter = localLimiter();
  for (let i = 0; i < limits["editorial-images"]; i++)
    assert.equal(await limiter.allow("editorial-images"), true);
  assert.equal(await limiter.allow("editorial-images"), false);
  for (const operation of [
    "search",
    "locations",
    "ai-intent",
    "ai-explanations",
    "affiliate",
  ] as const) {
    for (let i = 0; i < limits[operation]; i++)
      assert.equal(await limiter.allow(operation), true);
    assert.equal(await limiter.allow(operation), false);
  }
});
