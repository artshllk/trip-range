import "./guard.mjs";
// Explicit, isolated synthetic acceptance data. Never imported by application source.
import { appendFileSync } from "node:fs";
import { splitAviasalesApi } from "./api-split.mjs";
const mode = process.env.SYNTHETIC_INTEGRATION_MODE;
if (
  !["initial", "changed"].includes(mode) ||
  process.env.GOEKSPLO_SEARCH_ARRIVAL_FIXTURE !== "1" ||
  process.env.VERCEL ||
  process.env.VERCEL_ENV
)
  throw Error("Local synthetic verification only");
const log = (e) => {
  if (process.env.SEARCH_ARRIVAL_LOG)
    appendFileSync(process.env.SEARCH_ARRIVAL_LOG, JSON.stringify(e) + "\n");
};
globalThis.fetch = async (input, options = {}) => {
  const u = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  if (u.hostname === "synthetic-integration.upstash.io") {
    const command = JSON.parse(options.body);
    const operation = command[3]?.split(":").pop();
    log({ op: "quota", operation });
    return Response.json({ result: 1 });
  }
  if (
    u.hostname === "api.travelpayouts.com" &&
    u.pathname.endsWith("prices_for_dates")
  ) {
    const origin = u.searchParams.get("origin"),
      target = u.searchParams.get("destination"),
      month = u.searchParams.get("departure_at").slice(0, 7);
    log({ op: "flight", origin, target, month });
    const row = (destination, airport, price = 100, day = 20) => ({
      origin,
      origin_airport: origin,
      destination,
      ...(airport ? { destination_airport: airport } : {}),
      price,
      departure_at: `${month}-${day}`,
      return_at: `${month}-${day + 2}`,
      found_at: new Date().toISOString(),
    });
    let data = [
      row("VIE", "VIE", 50),
      row("PAR", "CDG", 70, 24),
      row("BER", "BER", 90, 22),
      row("YYC", "YYC", 100),
    ];
    if (mode === "initial" && origin !== "PRN")
      data.push(row("NLP", "MQP", origin === "SKP" ? 100 : 200));
    else if (mode === "changed") data.push(row("SZK", "SZK", 30));
    if (target) data = data.filter((x) => x.destination === target);
    if (origin === "TIA") data = [];
    return Response.json({
      success: true,
      currency: u.searchParams.get("currency"),
      data,
    });
  }
  if (
    u.hostname === "api.travelpayouts.com" &&
    u.pathname === "/links/v1/create"
  ) {
    const body = JSON.parse(options.body),
      link = body.links[0];
    log({
      op: "affiliate",
      path: new URL(link.url).pathname,
      placement: link.sub_id,
    });
    return Response.json({
      code: "success",
      status: 200,
      result: {
        links: [
          {
            url: link.url,
            code: "success",
            partner_url: "https://avs.io/IntegrationQA",
          },
        ],
      },
    });
  }
  if (u.hostname === "autocomplete.travelpayouts.com") {
    const term = (u.searchParams.get("term") || "").toLowerCase();
    const locations = [
      {
        type: "city",
        name: "Paris",
        code: "PAR",
        country_code: "FR",
        country_name: "France",
      },
      { type: "country", name: "South Africa", code: "ZA" },
      {
        type: "airport",
        name: "Kruger Mpumalanga Airport",
        code: "MQP",
        city_code: "NLP",
        country_code: "ZA",
        country_name: "South Africa",
      },
      {
        type: "city",
        name: "Ambiguous Kruger city group",
        code: "NLP",
        country_code: "ZA",
        country_name: "South Africa",
      },
    ];
    return Response.json(
      locations.filter(
        (x) =>
          x.name.toLowerCase().includes(term) || x.code.toLowerCase() === term,
      ),
    );
  }
  if (u.hostname === "commons.wikimedia.org")
    return Response.json({ query: { pages: [] } });
  if (u.hostname === "api.pexels.com") return Response.json({ photos: [] });
  log({ op: "blocked", host: u.hostname, path: u.pathname });
  throw Error("Blocked unexpected synthetic QA request");
};
// Real API shape: found_at is served from get_latest_prices, never prices_for_dates.
splitAviasalesApi();
