import { test } from "node:test";
import assert from "node:assert/strict";
import { CHILD_INPUT, renderInChild } from "./child-render";
import type { TripContentProps } from "../src/components/travel/TripContent";
import type { DestinationContentData } from "../src/domain/destination-content/types";
import {
  selectDayTemplate,
  selectDestinationContent,
} from "../src/content/presentation";
import { createReviewedDestinationContentStore } from "../src/content/runtime/store";
import { validateDestinationContentData } from "../src/domain/destination-content/validation";
import {
  tripContentDestinationId,
  tripContentFixture,
  tripContentFixtureContext,
  tripContentNow,
} from "./fixtures/trip-content";

const fallbackItinerary = [
  { en: "Arrival and free time", sq: "Mbërritja dhe koha e lirë" },
  { en: "Explore at your own pace", sq: "Eksploro sipas ritmit tënd" },
  { en: "Journey home", sq: "Kthimi në shtëpi" },
];
const propsFor = async (
  data: DestinationContentData = tripContentFixture(),
  now = tripContentNow,
): Promise<TripContentProps> => ({
  compact: true,
  result: await createReviewedDestinationContentStore(
    data,
    tripContentFixtureContext(),
    () => now,
  ).get(tripContentDestinationId),
  destinationId: tripContentDestinationId,
  nights: 2,
  locale: "en",
  fallbackItinerary,
});

/** React's Node HTML renderer runs outside the test runner's react-server condition. */
function render(props: TripContentProps) {
  return JSON.parse(
    renderInChild(
      `
    const { createElement } = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { renderTripContentSections } = require('./.test-build/src/components/travel/TripContent.js');
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw Error('Unexpected runtime research'); };
    const props = ${CHILD_INPUT};
    const sections = renderTripContentSections(props);
    const html = Object.fromEntries(Object.entries(sections).map(([key, value]) => [key, value === null ? null : renderToStaticMarkup(createElement('div', null, value))]));
    process.stdout.write(JSON.stringify({ sections: html, calls }));
  `,
      props,
    ),
  ) as {
    sections: Record<
      | "overview"
      | "days"
      | "attractions"
      | "areas"
      | "transport"
      | "practical"
      | "sources",
      string | null
    >;
    calls: number;
  };
}

test("rich synthetic reviewed content validates without changing the production records", async () => {
  const data = tripContentFixture();
  assert.deepEqual(
    validateDestinationContentData(data, tripContentFixtureContext()).ok,
    true,
  );
  const props = await propsFor(data);
  assert.equal(props.result.status, "reviewed");
  assert.equal(data.records[0].attractions?.length, 6);
  assert.equal(data.records[0].areas?.length, 3);
  const output = render(props);
  for (const section of Object.values(output.sections)) assert.ok(section);
  assert.equal(output.calls, 0);
});

test("destination selection requires the reviewed selected identity", async () => {
  const { result } = await propsFor();
  assert.ok(selectDestinationContent(result, tripContentDestinationId));
  assert.equal(selectDestinationContent(result, "unrelated-city"), undefined);
  assert.equal(
    selectDestinationContent(
      { status: "none", reason: "missing-record" },
      tripContentDestinationId,
    ),
    undefined,
  );
  if (result.status !== "reviewed") throw Error("fixture");
  result.content.reviewStatus = "withdrawn";
  assert.equal(
    selectDestinationContent(result, tripContentDestinationId),
    undefined,
  );
});

test("day selection prefers a narrow explicit night match without editing or reordering reviewed data", () => {
  const templates = tripContentFixture().records[0].dayTemplates!;
  const before = structuredClone(templates);
  assert.equal(selectDayTemplate(templates, 2)?.id, "day:synthetic:two-nights");
  assert.equal(selectDayTemplate(templates, 1)?.id, "day:synthetic:wide");
  assert.equal(selectDayTemplate(templates, 3)?.id, "day:synthetic:wide");
  for (const nights of [0, 4, 1.5, NaN])
    assert.equal(selectDayTemplate(templates, nights), undefined);
  assert.deepEqual(templates, before);
  assert.equal(selectDayTemplate(undefined, 2), undefined);
});

test("equally suitable day templates use stable IDs and exclude withdrawn templates", () => {
  const first = tripContentFixture().records[0].dayTemplates![1];
  const second = { ...structuredClone(first), id: "day:synthetic:aaa" };
  assert.equal(selectDayTemplate([first, second], 2)?.id, second.id);
  assert.equal(selectDayTemplate([second, first], 2)?.id, second.id);
  second.reviewStatus = "withdrawn";
  assert.equal(selectDayTemplate([second, first], 2)?.id, first.id);
});

test("reviewed outline uses chronological referenced stops without fabricating day assignments", async () => {
  const { sections } = render(await propsFor());
  assert.match(sections.days!, /Your 2-night plan/);
  assert.match(sections.days!, /Suggested stops for this stay/);
  assert.match(
    sections.days!,
    /href="#trip-attraction-attraction:synthetic:one"/,
  );
  assert.doesNotMatch(
    sections.days!,
    /Day 1|Day 2|Arrival and free time|A fictional small gallery/,
  );
  assert.ok(
    sections.days!.indexOf("Riverside Gallery") <
      sections.days!.indexOf("Market Courtyard"),
  );
});

test("unsupported length uses clearly generic trip outline and never stretches the closest reviewed template", async () => {
  const props = { ...(await propsFor()), nights: 5 };
  const { sections } = render(props);
  assert.match(sections.days!, /Trip outline/);
  assert.match(sections.days!, /General planning outline/);
  assert.match(sections.days!, /Arrival and free time/);
  assert.doesNotMatch(
    sections.days!,
    /Your trip|Gallery, gardens and courtyard|Suitable for/,
  );
});

test("no reviewed content and destination mismatch have no empty destination sections", async () => {
  const base = await propsFor();
  for (const props of [
    { ...base, result: { status: "none", reason: "missing-record" } as const },
    { ...base, destinationId: "other-destination" },
  ]) {
    const { sections, calls } = render(props);
    assert.match(sections.days!, /Trip outline/);
    for (const [key, section] of Object.entries(sections))
      if (key !== "days") assert.equal(section, null, key);
    assert.equal(calls, 0);
  }
});

test("partial reviewed content omits unsupported sections while retaining the normal outline", async () => {
  const data = tripContentFixture();
  const record = data.records[0];
  delete record.attractions;
  delete record.dayTemplates;
  delete record.areas;
  delete record.transport;
  delete record.practicalNotes;
  const { sections } = render(await propsFor(data));
  assert.match(sections.overview!, /fictional riverside city/);
  assert.match(sections.days!, /Trip outline/);
  for (const key of ["attractions", "areas", "transport", "practical"] as const)
    assert.equal(sections[key], null);
});

test("expired volatile content never renders and periodic content expires independently", async () => {
  const data = tripContentFixture();
  const expired = render(
    await propsFor(data, Date.parse("2026-10-16T00:00:00Z")),
  );
  const markup = Object.values(expired.sections).join("");
  assert.doesNotMatch(
    markup,
    /Seasonal Glasshouse|Synthetic current closure note|Synthetic transit observation|4\.5 EUR/,
  );
  assert.match(markup, /Riverside Gallery|Walking between neighbourhoods/);
  const later = render(
    await propsFor(data, Date.parse("2026-10-31T00:00:00Z")),
  );
  assert.equal(later.sections.transport, null);
});

test("withdrawn content is absent and templates never retain a withdrawn attraction", async () => {
  const data = tripContentFixture();
  data.records[0].attractions![0].reviewStatus = "withdrawn";
  const { sections } = render(await propsFor(data));
  assert.doesNotMatch(sections.attractions!, /Riverside Gallery/);
  assert.match(sections.days!, /Trip outline/);
  data.records[0].reviewStatus = "withdrawn";
  const withdrawn = render(await propsFor(data));
  assert.equal(withdrawn.sections.overview, null);
  assert.equal(withdrawn.sections.attractions, null);
});

test("source links, types and original observed currency/date remain explicit and separate from the budget", async () => {
  const { sections } = render(await propsFor());
  assert.match(sections.transport!, /Observed price: <strong>4\.5 EUR/);
  assert.match(
    sections.transport!,
    /dateTime="2026-10-09T00:00:00Z">9 Oct 2026/,
  );
  assert.match(
    sections.transport!,
    /href="#destination-source-source:synthetic:official"/,
  );
  assert.match(sections.transport!, /does not change your trip budget/);
  assert.match(sections.sources!, /Official source/);
  assert.match(sections.sources!, /Reviewed editorial source/);
  assert.match(
    sections.sources!,
    /href="https:\/\/example.org\/synthetic-fare" target="_blank" rel="noopener noreferrer"/,
  );
  assert.doesNotMatch(
    Object.values(sections).join(""),
    /live price|Recent fare|Fits your budget|whole trip/,
  );
});

test("stable facts avoid timestamp clutter while volatile information carries its checked date", async () => {
  const { sections } = render(await propsFor());
  assert.doesNotMatch(sections.overview!, /Checked|2026/);
  assert.doesNotMatch(sections.attractions!, /Checked|2026/);
  assert.match(
    sections.sources!,
    /Checked <time dateTime="2026-10-09T00:00:00Z">9 Oct 2026/,
  );
});

test("retained translation chrome renders with explicit English fallback for English-only records", async () => {
  const props = { ...(await propsFor()), locale: "sq" as const };
  const { sections } = render(props);
  assert.match(sections.days!, /Udhëtimi yt/);
  assert.match(sections.attractions!, /Vende që ia vlen të shohësh/);
  assert.match(sections.attractions!, /Galeria buzë lumit/);
  assert.match(sections.transport!, /4,5 EUR/);
  assert.match(sections.transport!, /9 tet 2026/);
  assert.doesNotMatch(
    sections.attractions!,
    /Riverside Gallery|A fictional small gallery/,
  );
  assert.doesNotMatch(sections.days!, /Your trip|Start with the gallery/);
  const data = tripContentFixture();
  delete data.records[0].attractions![0].name.sq;
  const incomplete = render({ ...(await propsFor(data)), locale: "sq" });
  assert.match(incomplete.sections.attractions!, /Riverside Gallery/);
  assert.match(incomplete.sections.days!, /Udhëtimi yt/);
});

test("text-first attractions ignore reserved media references and all rendering makes zero external calls", async () => {
  const data = tripContentFixture();
  data.records[0].attractions![0].media = {
    subject: "attraction:synthetic:one",
    role: "attraction.primary",
  };
  const context = tripContentFixtureContext();
  context.mediaSubjects = ["attraction:synthetic:one"];
  const result = await createReviewedDestinationContentStore(
    data,
    context,
    () => tripContentNow,
  ).get(tripContentDestinationId);
  const { sections, calls } = render({ ...(await propsFor()), result });
  assert.doesNotMatch(
    Object.values(sections).join(""),
    /<img|<iframe|wikimedia|pexels|openai/i,
  );
  assert.equal(calls, 0);
});

test("source rendering retains required OSM attribution and licensing", async () => {
  const data = tripContentFixture();
  data.records[0].sources.push({
    id: "source:synthetic:osm",
    type: "openstreetmap",
    title: "Synthetic map reference",
    publisher: "OpenStreetMap",
    externalId: { authority: "openstreetmap", id: "node/900000002" },
    url: "https://www.openstreetmap.org/node/900000002",
    licensing: {
      identifier: "ODbL-1.0",
      url: "https://opendatacommons.org/licenses/odbl/1.0/",
      attribution: "© OpenStreetMap contributors",
    },
  });
  data.records[0].attractions![0].sourceIds.push("source:synthetic:osm");
  const { sections } = render(await propsFor(data));
  assert.match(sections.sources!, /© OpenStreetMap contributors/);
  assert.match(sections.sources!, /ODbL-1.0/);
});

test("content rendering never mutates the reviewed data or generic itinerary", async () => {
  const props = await propsFor();
  const before = structuredClone(props);
  render(props);
  assert.deepEqual(props, before);
});

test("missing reviewed and generic outlines produce no empty days heading", async () => {
  const { sections } = render({
    ...(await propsFor()),
    result: { status: "none", reason: "missing-record" },
    fallbackItinerary: [],
  });
  assert.equal(sections.days, null);
});

test("content sections preserve semantic heading levels and useful attraction links", async () => {
  const { sections } = render(await propsFor());
  assert.doesNotMatch(Object.values(sections).join(""), /<h1/);
  for (const key of ["days", "attractions", "transport"] as const) {
    assert.equal(sections[key]?.match(/<h2\b/g)?.length, 1);
    assert.match(sections[key]!, /aria-labelledby="trip-/);
  }
  assert.equal(sections.attractions?.match(/<h3\b/g)?.length, 6);
  assert.equal(sections.areas?.match(/<h3\b/g)?.length, 3);
  assert.doesNotMatch(sections.areas!, /<h2/);
  assert.doesNotMatch(sections.practical!, /<h2/);
  assert.match(sections.days!, />Riverside Gallery<\/a>/);
});

test("primary attractions use explicit editorial order and keep overflow behind a closed disclosure", async () => {
  const props = await propsFor();
  const { sections } = render(props);
  assert.match(
    sections.attractions!,
    /<details class="trip-content-more"><summary>\+ 1 more place/,
  );
  assert.doesNotMatch(
    sections.attractions!,
    /<details[^>]*open|trip-content-card|<img/,
  );
  assert.ok(
    sections.attractions!.indexOf("Riverside Gallery") <
      sections.attractions!.indexOf("Market Courtyard"),
  );
  assert.match(
    sections.attractions!,
    /Seasonal Glasshouse/,
    "Overflow is retained in the DOM and accessible through disclosure",
  );
});

test("long descriptions are abbreviated visibly with the full reviewed text preserved", async () => {
  const data = tripContentFixture();
  const full = "A sourced description with important qualifications. "
    .repeat(10)
    .trim();
  data.records[0].attractions![0].shortDescription.en = full;
  const { sections } = render(await propsFor(data));
  assert.match(
    sections.attractions!,
    /A sourced description with important qualifications\.<\/p><details class="trip-place-details"><summary>Before you go/,
  );
  assert.ok(sections.attractions!.includes(full));
  assert.doesNotMatch(sections.attractions!, /line-clamp|overflow:hidden/);
});

test("primary guidance is bounded, generic, and never mutates editorial order", async () => {
  const data = tripContentFixture();
  const record = data.records[0];
  record.transport = Array.from({ length: 5 }, (_, i) => ({
    ...structuredClone(record.transport![0]),
    id: `transport:order:${i}`,
  }));
  record.practicalNotes = Array.from({ length: 7 }, (_, i) => ({
    ...structuredClone(record.practicalNotes![0]),
    id: `note:order:${i}`,
  }));
  const original = structuredClone(data);
  const { sections } = render(await propsFor(data));
  assert.match(sections.transport!, /More transport details/);
  assert.match(sections.practical!, /More useful details/);
  assert.doesNotMatch(sections.transport!, /trip-content-card/);
  assert.deepEqual(data, original);
});

test("explicit calendar-day plans render localized day groups, linked stops and their notes", async () => {
  const data = tripContentFixture();
  const record = data.records[0];
  const chosen = record.dayTemplates!.find(
    (template) => template.suitableNights.length === 1,
  )!;
  chosen.suitableNights = [2];
  chosen.stops = record.attractions!.slice(0, 3).map((attraction, index) => ({
    attractionId: attraction.id,
    day: index + 1,
    notes: {
      en: `Optional stop ${index + 1}`,
      sq: `Ndalesë fakultative ${index + 1}`,
    },
  }));
  record.dayTemplates = [chosen];
  assert.equal(
    validateDestinationContentData(data, tripContentFixtureContext()).ok,
    true,
  );
  const props = await propsFor(data);
  for (const locale of ["en", "sq"] as const) {
    const { sections } = render({ ...props, locale, startDate: "2027-01-31" });
    const html = sections.days!;
    if (locale === "en") {
      assert.match(html, /31 Jan/);
      assert.match(html, /1 Feb/);
      assert.match(html, /2 Feb/);
    }
    assert.match(html, /role="tablist"/);
    assert.equal((html.match(/role="tab"/g) ?? []).length, 3);
    assert.equal((html.match(/role="tabpanel"/g) ?? []).length, 3);
    assert.equal((html.match(/aria-selected="true"/g) ?? []).length, 1);
    assert.equal((html.match(/hidden=""/g) ?? []).length, 2);
    assert.match(html, locale === "en" ? /Day 1/ : /Dita 1/);
    assert.match(
      html,
      locale === "en"
        ? /Departure · only if time permits/
        : /Nisja · vetëm nëse ka kohë/,
    );
    for (const stop of chosen.stops) {
      assert.ok(html.includes(`#trip-attraction-${stop.attractionId}`));
      assert.ok(html.includes(stop.notes![locale]));
    }
  }
});

test("calendar-day templates reject partial, unordered, missing, ambiguous and out-of-range days", () => {
  for (const days of [
    [1, undefined, 3],
    [1, 3, 2],
    [1, 1, 3],
    [0, 2, 3],
    [1, 2, 4],
    [1, 2, 2.5],
  ]) {
    const data = tripContentFixture();
    const record = data.records[0];
    record.dayTemplates![0].suitableNights = [2];
    record.dayTemplates![0].stops = record
      .attractions!.slice(0, 3)
      .map((attraction, index) => ({
        attractionId: attraction.id,
        ...(days[index] === undefined ? {} : { day: days[index] }),
      }));
    assert.equal(
      validateDestinationContentData(data, tripContentFixtureContext()).ok,
      false,
      JSON.stringify(days),
    );
  }
  const data = tripContentFixture();
  data.records[0].dayTemplates![0].suitableNights = [2, 3];
  data.records[0].dayTemplates![0].stops[0].day = 1;
  assert.equal(
    validateDestinationContentData(data, tripContentFixtureContext()).ok,
    false,
  );
});

test("compact trip presentation is opt-in; evergreen guides retain their full current layout", async () => {
  const props = await propsFor();
  const { sections } = render({ ...props, compact: undefined });
  assert.match(sections.days!, /Your trip/);
  assert.doesNotMatch(sections.days!, /role="tab"/);
  assert.doesNotMatch(
    sections.attractions!,
    /Before you go|trip-place-details|In your plan/,
  );
  assert.doesNotMatch(sections.areas!, /What to check|trip-area-details/);
  assert.doesNotMatch(sections.sources!, /About this destination/);
  assert.ok(
    sections.attractions!.includes(
      props.result.status === "reviewed"
        ? props.result.content.attractions![0].shortDescription.en
        : "",
    ),
  );
});
