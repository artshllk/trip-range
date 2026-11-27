/** Run against the local production build with serve-results-v2-fixture.mjs. */
import assert from "node:assert/strict";

const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3162";
assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
const canonicalOrigin = "https://www.trip-range.com";
const socialImage = `${canonicalOrigin}/branding/trip-range/social-1200x630.png`;
const request = async (path) => {
  assert.ok(path.startsWith("/") && !path.startsWith("//"));
  const response = await fetch(origin + path, {
    redirect: "manual",
    headers: { "user-agent": "Googlebot" },
    signal: AbortSignal.timeout(60000),
  });
  return { response, text: await response.text() };
};
const tags = (html, name) =>
  [...html.matchAll(/<(?:meta|link)\b[^>]*>/g)]
    .map((match) =>
      Object.fromEntries(
        [...match[0].matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
      ),
    )
    .filter((tag) => [tag.name, tag.property, tag.rel].includes(name))
    .map((tag) => tag.content ?? tag.href);

const robots = await request("/robots.txt");
assert.equal(robots.response.status, 200);
assert.match(
  robots.text,
  /^Sitemap: https:\/\/www\.trip-range\.com\/sitemap\.xml$/m,
);
assert.match(robots.text, /^Disallow: \/api\/$/m);
assert.doesNotMatch(robots.text, /goeksplo\.com/);

const sitemap = await request("/sitemap.xml");
assert.equal(sitemap.response.status, 200);
const urls = [...sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
  (m) => m[1],
);
assert.ok(urls.length >= 2);
assert.equal(new Set(urls).size, urls.length);
assert.ok(urls.includes(`${canonicalOrigin}/`));
assert.ok(urls.includes(`${canonicalOrigin}/about`));
let schemas = 0;
for (const url of urls) {
  const parsed = new URL(url);
  assert.equal(parsed.origin, canonicalOrigin);
  assert.match(parsed.pathname, /^\/en(?:\/|$)/);
  assert.doesNotMatch(parsed.pathname, /\/plan(?:\/|$)|\/api(?:\/|$)/);
  assert.equal(parsed.search, "");
  assert.equal(parsed.hash, "");
  const page = await request(parsed.pathname);
  assert.equal(page.response.status, 200, url);
  assert.deepEqual(tags(page.text, "canonical"), [url], url);
  assert.deepEqual(tags(page.text, "og:url"), [url], url);
  assert.deepEqual(tags(page.text, "og:image"), [socialImage], url);
  assert.deepEqual(tags(page.text, "twitter:image"), [socialImage], url);
  assert.deepEqual(tags(page.text, "robots"), ["index, follow"], url);
  assert.doesNotMatch(
    page.response.headers.get("x-robots-tag") ?? "",
    /noindex/,
  );
  for (const match of page.text.matchAll(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
  )) {
    const schema = JSON.parse(match[1]);
    assert.doesNotMatch(
      JSON.stringify(schema),
      /https?:\/\/(?:www\.)?goeksplo\.com/,
    );
    if (schema["@type"] === "Organization") {
      assert.equal(schema.name, "Trip Range");
      assert.equal(schema.url, canonicalOrigin);
      assert.equal(
        schema.logo,
        `${canonicalOrigin}/branding/trip-range/trip-range-icon-light.svg`,
      );
      schemas++;
    }
    if (schema["@type"] === "BreadcrumbList") {
      for (const item of schema.itemListElement)
        assert.equal(new URL(item.item).origin, canonicalOrigin);
      schemas++;
    }
  }
}
assert.ok(schemas > 0, "Rendered structured data was checked");
const query =
  "?origin=zurich&budget=800&currency=EUR&start=2027-01-20&end=2027-01-22&when=custom&adults=2&children=0&styles=city&stay=standard&flexDays=0";
for (const path of ["/plan", "/plan/results", "/plan/trips/vienna"]) {
  const page = await request(path + query);
  assert.equal(page.response.status, 200, path);
  assert.deepEqual(tags(page.text, "robots"), ["noindex, follow"], path);
  assert.deepEqual(tags(page.text, "canonical"), [], path);
  assert.deepEqual(tags(page.text, "og:image"), [socialImage], path);
  assert.deepEqual(tags(page.text, "twitter:image"), [socialImage], path);
}
for (const document of ["privacy", "terms", "affiliate-disclosure"]) {
  const path = `/${document}`;
  const page = await request(path);
  assert.equal(page.response.status, 200, path);
  assert.deepEqual(tags(page.text, "canonical"), [canonicalOrigin + path]);
  assert.deepEqual(tags(page.text, "robots"), ["noindex, follow"]);
  assert.deepEqual(tags(page.text, "og:image"), [socialImage]);
  assert.deepEqual(tags(page.text, "twitter:image"), [socialImage]);
}
const legacy = await request("/sq/plan/results" + query);
assert.equal(legacy.response.status, 308);
const redirected = new URL(legacy.response.headers.get("location"), origin);
assert.equal(redirected.origin, origin);
assert.equal(redirected.pathname, "/plan/results");
assert.deepEqual([...redirected.searchParams], [...new URLSearchParams(query)]);
const image = await fetch(origin + new URL(socialImage).pathname);
assert.equal(image.status, 200);
assert.match(image.headers.get("content-type"), /image\/png/);
console.log(
  `PASS ${urls.length} sitemap pages: canonical/OG/Twitter URLs, ${schemas} structured-data blocks, robots.txt, social image, 3 personalized noindex routes, 3 legal pages and query-preserving English redirect; local fixture only.`,
);
