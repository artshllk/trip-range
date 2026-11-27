import "./guard.mjs";
/** Explicit local QA only. Extends bounded SEO fixtures with global autocomplete. */
import "./seo.mjs";
const previousFetch = globalThis.fetch;
const cities = [
  {
    name: "London",
    code: "LON",
    country_code: "GB",
    country_name: "United Kingdom",
  },
  {
    name: "New York",
    code: "NYC",
    country_code: "US",
    country_name: "United States",
  },
  { name: "Tokyo", code: "TYO", country_code: "JP", country_name: "Japan" },
  {
    name: "Dubai",
    code: "DXB",
    country_code: "AE",
    country_name: "United Arab Emirates",
  },
  {
    name: "Cape Town",
    code: "CPT",
    country_code: "ZA",
    country_name: "South Africa",
  },
];
globalThis.fetch = async (input, options) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  if (url.hostname === "autocomplete.travelpayouts.com") {
    const term = (url.searchParams.get("term") ?? "").toLowerCase();
    return Response.json(
      cities
        .filter(
          (c) =>
            c.name.toLowerCase().includes(term) ||
            c.code.toLowerCase() === term,
        )
        .map((c) => ({ ...c, type: "city" })),
    );
  }
  return previousFetch(input, options);
};
