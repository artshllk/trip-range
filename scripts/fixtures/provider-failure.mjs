import "./guard.mjs";
/** Explicit local-only failure simulation. Never imported by application code. */
if (
  process.env.VERCEL ||
  process.env.VERCEL_ENV ||
  process.env.GOEKSPLO_FAILURE_FIXTURE !== "1"
)
  throw Error("Provider failure fixture requires local opt-in");
const realFetch = globalThis.fetch;
const providers = new Set([
  "api.travelpayouts.com",
  "autocomplete.travelpayouts.com",
  "commons.wikimedia.org",
  "api.pexels.com",
  "api.openai.com",
]);
globalThis.fetch = async (input, options) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  return providers.has(url.hostname)
    ? new Response(null, { status: 503 })
    : realFetch(input, options);
};
