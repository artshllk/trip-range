import "./guard.mjs";
if (process.env.VERCEL || process.env.VERCEL_ENV) throw Error("Local fixtures are forbidden on deployed environments");
/** Explicit opt-in local verification fixture. Load with node --import; never imported by app code. */
import { appendFileSync } from "node:fs";
import { splitAviasalesApi } from "./api-split.mjs";
if (process.env.GOEKSPLO_NEARBY_FIXTURE !== "1")
  throw new Error("Local nearby fixture requires explicit opt-in");
const originalFetch = globalThis.fetch;
const record = (event) => {
  if (process.env.NEARBY_FIXTURE_LOG)
    appendFileSync(
      process.env.NEARBY_FIXTURE_LOG,
      JSON.stringify(event) + "\n",
    );
};
globalThis.fetch = async (input, options) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  if (
    url.hostname === "api.travelpayouts.com" &&
    url.pathname.endsWith("prices_for_dates")
  ) {
    const code = url.searchParams.get("origin");
    const month = url.searchParams.get("departure_at");
    const december = month === "2026-12";
    const price = (
      december ? { PRN: 70, SKP: 50, TIA: 40 } : { PRN: 130, SKP: 30, TIA: 20 }
    )[code];
    record({ type: "discovery", origin: code, month });
    return Response.json({
      success: true,
      data: price
        ? [
            {
              origin: code,
              destination: "VIE",
              price,
              departure_at: december ? "2026-12-05" : "2026-11-07",
              return_at: december ? "2026-12-07" : "2026-11-09",
              found_at: new Date().toISOString(),
            },
          ]
        : [],
    });
  }
  if (
    url.hostname === "api.travelpayouts.com" &&
    url.pathname === "/links/v1/create"
  ) {
    const body = JSON.parse(String(options.body));
    const original = body.links[0].url;
    record({
      type: "affiliate",
      destinationUrl: original,
      subId: body.links[0].sub_id,
    });
    const partner = new URL("https://tp.media/r");
    partner.search = new URLSearchParams({
      marker: `${body.marker}.${body.links[0].sub_id}`,
      trs: String(body.trs),
      p: "4114",
      u: original,
    }).toString();
    return Response.json({
      code: "success",
      status: 200,
      result: {
        links: [{ code: "success", url: original, partner_url: partner.href }],
      },
    });
  }
  if (url.hostname === "commons.wikimedia.org")
    return Response.json({ query: { pages: [] } });
  return originalFetch(input, options);
};
// Real API shape: found_at is served from get_latest_prices, never prices_for_dates.
splitAviasalesApi();
