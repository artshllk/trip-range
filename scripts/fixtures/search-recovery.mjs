import "./guard.mjs";
/** Synthetic local QA only. Intercepts every outbound request; no live credentials/inventory. */
import { appendFileSync } from "node:fs";
import { splitAviasalesApi } from "./api-split.mjs";
if (
  process.env.VERCEL ||
  process.env.VERCEL_ENV ||
  process.env.GOEKSPLO_SEARCH_RECOVERY_FIXTURE !== "1"
)
  throw Error("Search recovery fixture requires explicit local opt-in");
globalThis.fetch = async (input) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  if (url.hostname === "synthetic-search-qa.upstash.io")
    return Response.json({ result: 1 });
  if (
    url.hostname === "api.travelpayouts.com" &&
    url.pathname.endsWith("prices_for_dates")
  ) {
    const origin = url.searchParams.get("origin"),
      month = url.searchParams.get("departure_at").slice(0, 7);
    if (process.env.SEARCH_RECOVERY_LOG)
      appendFileSync(
        process.env.SEARCH_RECOVERY_LOG,
        JSON.stringify({ operation: "synthetic-discovery", origin, month }) +
          "\n",
      );
    if (month === "2027-04") return new Response(null, { status: 503 });
    const row = (destination, airport, price, day = 20) => ({
      origin,
      origin_airport: origin,
      destination,
      destination_airport: airport,
      price,
      departure_at: `${month}-${day}`,
      return_at: `${month}-${day + 2}`,
      found_at: new Date().toISOString(),
    });
    let data =
      month === "2027-02" || month === "2027-05"
        ? []
        : month === "2027-03"
          ? [row("YYC", "YYC", 100)]
          : [
              row("VIE", "VIE", 50),
              row("YYC", "YYC", 100),
              row("FAT", "FAT", 110),
              row("PAR", "CDG", 70, 24),
            ];
    const target = url.searchParams.get("destination");
    if (target) data = data.filter((r) => r.destination === target);
    return Response.json({
      success: true,
      currency: url.searchParams.get("currency"),
      data,
    });
  }
  if (url.hostname === "autocomplete.travelpayouts.com")
    return Response.json(
      /^(london|lon)$/i.test(url.searchParams.get("term") ?? "")
        ? [
            {
              type: "city",
              code: "LON",
              name: "London",
              country_code: "GB",
              country_name: "United Kingdom",
            },
          ]
        : [],
    );
  if (url.hostname === "commons.wikimedia.org")
    return Response.json({ query: { pages: [] } });
  if (url.hostname === "api.pexels.com") return Response.json({ photos: [] });
  throw Error(
    `Unexpected outbound request in offline search QA: ${url.hostname}`,
  );
};
// Real API shape: found_at is served from get_latest_prices, never prices_for_dates.
splitAviasalesApi();
