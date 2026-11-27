import "./guard.mjs";
/** Explicit local preload only. Logs operation names, never requests or credentials. */
import { appendFileSync } from "node:fs";
import "./seo.mjs";
if (
  process.env.GOEKSPLO_EDITORIAL_FIXTURE !== "1" ||
  process.env.RATE_LIMIT_REDIS_REST_URL !==
    "https://editorial-fixture.upstash.io" ||
  process.env.RATE_LIMIT_REDIS_REST_TOKEN !== "synthetic-editorial-fixture" ||
  !process.env.EDITORIAL_FIXTURE_LOG
)
  throw Error(
    "Editorial fixture requires explicit local synthetic configuration",
  );
const wrappedFetch = globalThis.fetch;
const record = (operation) =>
  appendFileSync(
    process.env.EDITORIAL_FIXTURE_LOG,
    JSON.stringify({ operation }) + "\n",
  );
globalThis.fetch = async (input, options) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  if (url.hostname === "editorial-fixture.upstash.io") {
    const command = JSON.parse(String(options?.body));
    const operation = String(command[3]).split(":").at(-1);
    if (
      ![
        "editorial-images",
        "search",
        "locations",
        "ai-intent",
        "ai-explanations",
        "affiliate",
      ].includes(operation)
    )
      throw Error("Unexpected fixture operation");
    record(operation);
    return Response.json({ result: 1 });
  }
  if (url.hostname === "commons.wikimedia.org") record("commons");
  if (url.hostname === "api.pexels.com") record("pexels");
  if (
    [
      "api.openai.com",
      "api.travelpayouts.com",
      "autocomplete.travelpayouts.com",
    ].includes(url.hostname)
  )
    record("unexpected-provider");
  return wrappedFetch(input, options);
};
