import assert from "node:assert/strict";
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3110";
const paths = [
  "/from/zurich",
  "/from/zurich/weekend-trips",
  "/from/zurich/weekend-trips-under-500",
];
const canonical = (path) => "https://www.trip-range.com" + path;
const fetchPage = async (path) => {
  const response = await fetch(origin + path, {
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
  return { response, html: await response.text() };
};
const data = (html) =>
  [
    ...html.matchAll(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
    ),
  ].map((m) => JSON.parse(m[1]));
const robots = (html) =>
  [...html.matchAll(/<meta name="robots" content="([^"]+)"/g)].map((m) => m[1]);
const indexed = [];
for (const [i, path] of paths.entries()) {
  const { response, html } = await fetchPage(path);
  assert.equal(response.status, 200, path);
  assert.equal((html.match(/<h1\b/g) || []).length, 1, "one H1 " + path);
  assert.deepEqual(
    [...html.matchAll(/<link rel="canonical" href="([^"]+)"/g)].map(
      (m) => m[1],
    ),
    [canonical(path)],
  );
  const policy = robots(html);
  assert.equal(policy.length, 1);
  assert.ok(["index, follow", "noindex, follow"].includes(policy[0]));
  if (policy[0] === "index, follow") indexed.push(canonical(path));
  assert.ok(html.includes("How GoEksplo calculates the budget"));
  assert.ok(html.includes("not expected spending"));
  assert.ok(html.includes("not guaranteed live inventory"));
  assert.ok(html.includes("Find trips for my budget"));
  const searchLink = html.match(/href="(\/plan\/results\?[^"]+)"/);
  assert.ok(searchLink, "normal planner CTA");
  const query = new URL(searchLink[1].replaceAll("&amp;", "&"), origin)
    .searchParams;
  assert.equal(query.get("origin"), "zurich");
  assert.equal(
    query.has("dateMode"),
    false,
    "Zurich keeps fixed weekend semantics",
  );
  assert.equal(query.get("budget"), i === 2 ? "500" : "700");
  assert.ok(!/<link[^>]+hrefLang="sq"/.test(html), "no invented translation");
  assert.ok(
    !/data state:|insufficient provider-supported routes|fewer than two complete trips/.test(
      html,
    ),
    "no internal diagnostics",
  );
  const schemas = data(html);
  assert.equal(schemas.length, 1);
  const breadcrumb = schemas[0];
  assert.equal(breadcrumb["@type"], "BreadcrumbList");
  assert.equal(breadcrumb.itemListElement.length, i + 2);
  breadcrumb.itemListElement.forEach((item, n) => {
    assert.equal(item.position, n + 1);
    assert.equal(item.item, canonical(n === 0 ? "/" : paths[n - 1]));
    assert.ok(html.includes(item.name));
  });
  assert.ok(
    !/"@type":"(?:Offer|Product|Review|AggregateRating|Hotel)"/.test(
      JSON.stringify(schemas),
    ),
  );
  for (const suffix of [
    "?budget=1&origin=london&styles=beach",
    "?utm_source=check",
  ]) {
    const filtered = await fetchPage(path + suffix);
    assert.equal(filtered.response.status, 200);
    assert.deepEqual(robots(filtered.html), ["noindex, follow"]);
    assert.ok(filtered.html.includes(`href="${canonical(path)}"`));
  }
  const trailing = await fetchPage(path + "/");
  assert.equal(trailing.response.status, 308);
  assert.equal(trailing.response.headers.get("location"), path);
  console.log(
    `PASS ${path}: ${policy[0]}, canonical, H1, schema, methodology, query policy`,
  );
}
for (const path of [
  "/from",
  "/research",
  ...["london", "manchester", "dublin", "chicago"].flatMap((slug) => [
    `/from/${slug}`,
    `/from/${slug}/weekend-trips`,
    `/from/${slug}/weekend-trips-under-${slug === "chicago" ? 1200 : 500}`,
  ]),
  "/research/london-weekend-budget-snapshot",
  "/from/zurich/weekend-trips-under-300",
  "/from/zurich/weekend-trips-under-700",
  "/sq/from/zurich",
  "/from/zurich/weekend-trips/extra",
]) {
  const { response, html } = await fetchPage(path);
  assert.equal(response.status, 404, path);
  assert.ok(
    robots(html).some((r) => r.includes("noindex")),
    path,
  );
}
for (const path of [
  "/plan",
  "/plan/results?scope=domestic",
  "/plan/trips/prizren?scope=domestic",
  "/privacy",
  "/terms",
  "/from/prishtina/weekend-trips/under-300",
  "/sq/nga/prishtina/fundjava/nen-300",
]) {
  const { response, html } = await fetchPage(path);
  assert.equal(response.status, 200);
  assert.deepEqual(robots(html), ["noindex, follow"], path);
}
const { html: home } = await fetchPage("/");
assert.deepEqual(data(home), [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "GoEksplo",
    url: "https://www.trip-range.com",
  },
]);
const { response: sitemapResponse, html: xml } =
  await fetchPage("/sitemap.xml");
assert.equal(sitemapResponse.status, 200);
const urls = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
assert.deepEqual(
  urls.sort(),
  [canonical("/"), canonical("/sq"), ...indexed].sort(),
);
assert.equal(
  (xml.match(/<lastmod>/g) || []).length,
  2,
  "only preserved editorial homepage dates",
);
if (process.env.VERIFY_SEO_SITEMAP_COUNT)
  assert.equal(urls.length, Number(process.env.VERIFY_SEO_SITEMAP_COUNT));
console.log(
  `PASS ${urls.length} sitemap URLs match metadata policy; drafts/EN-only/private routes and Organization schema verified`,
);
