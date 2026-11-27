import { approvedMediaSubjects } from "./fixtures/approved-media";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  pilotContentData as destinationContentData,
  pilotIdentities as identities,
} from "./fixtures/destination-experience-pilot";
import type { DayTemplate } from "../src/domain/destination-content/types";

import { createPinnedDestinationContentStore } from "../src/content/runtime/publication";
import { validateDestinationContentData } from "../src/domain/destination-content/validation";
import { draftContentPreview } from "./fixtures/destination-content-draft-preview";
import { selectDayTemplate } from "../src/content/presentation";
import candidates from "../docs/research/destination-media/phase2/candidates.json";

const context = {
  identities,
  mediaSubjects: identities.map((identity) => identity.subject),
};
const now = Date.parse("2026-10-22T12:00:00Z");

test("Vienna and London pilot preserves the human publication gate and canonical identity", async () => {
  assert.equal(
    validateDestinationContentData(destinationContentData, context).ok,
    true,
  );
  for (const [id, external] of [
    ["vienna", "Q1741"],
    ["london", "Q84"],
  ]) {
    const record = destinationContentData.records.find(
      (record) => record.destinationId === id,
    )!;
    assert.equal(record.reviewStatus, "draft");
    assert.equal(record.reviewedAt, null);
    assert.equal("publication" in record, false);
    assert.equal(
      identities.find((identity) => identity.subject === id)?.external?.id,
      external,
    );
    assert.equal(
      (
        await createPinnedDestinationContentStore(
          destinationContentData,
          context,
          () => now,
        ).get(id)
      ).status,
      "none",
    );
    const preview = await draftContentPreview(
      destinationContentData,
      context,
      id,
      now,
    );
    assert.equal(preview.status, "reviewed");
    if (preview.status !== "reviewed") throw Error("preview");
    assert.equal(preview.content.attractions?.length, 5);
    assert.equal(preview.content.areas?.length, 3);
    assert.ok(preview.content.transport!.length >= 2);
    for (const nights of [2, 3]) {
      const template: DayTemplate = selectDayTemplate(
        preview.content.dayTemplates,
        nights,
      )!;
      assert.deepEqual(
        [...new Set(template.stops.map((stop) => stop.day))],
        Array.from({ length: nights + 1 }, (_, i) => i + 1),
      );
      assert.ok(
        template.stops.every((stop) =>
          preview.content.attractions!.some(
            (attraction) => attraction.id === stop.attractionId,
          ),
        ),
      );
      assert.ok(
        template.stops.every((stop) => stop.notes?.en && stop.notes?.sq),
      );
    }
    assert.equal(selectDayTemplate(preview.content.dayTemplates, 4), undefined);
    assert.ok(
      preview.content.attractions!.every(
        (place) => place.bookingAdvice?.en && place.bookingAdvice?.sq,
      ),
    );
    assert.ok(
      preview.content.sources.every(
        (source) => source.type === "official" || source.type === "wikidata",
      ),
    );
    assert.ok(
      preview.content.transport!.every((guide) => !guide.observedPrice),
    );
  }
});

test("Vienna construction guidance expires independently rather than silently asserting normal CAT/S7 trains", async () => {
  const result = await draftContentPreview(
    destinationContentData,
    context,
    "vienna",
    Date.parse("2026-11-20T12:00:00Z"),
  );
  assert.equal(result.status, "reviewed");
  if (result.status !== "reviewed") throw Error("preview");
  assert.ok(
    !result.content.transport!.some((guide) =>
      guide.id.endsWith(":airport-works"),
    ),
  );
  assert.ok(
    result.content.transport!.some((guide) =>
      guide.id.endsWith(":airport-mainline"),
    ),
  );
});

test("local media candidates retain verified bytes, accurate place identity and derivative licence evidence independently of the separately owner-approved runtime selections", () => {
  const registry = JSON.parse(
    readFileSync("content/media/approved.json", "utf8"),
  );
  assert.equal(registry.selections.length, approvedMediaSubjects.length * 2);
  assert.deepEqual(
    [
      ...new Set(
        registry.selections.map((s: { subject: string }) => s.subject),
      ),
    ].sort(),
    approvedMediaSubjects,
  );
  for (const candidate of candidates.candidates) {
    assert.equal(candidate.approval, "pending-human-review");
    assert.equal(
      candidate.entity,
      candidate.destinationId === "vienna" ? "Q1741" : "Q84",
    );
    assert.match(
      candidate.sourcePage,
      /^https:\/\/commons.wikimedia.org\/wiki\/File:/,
    );
    assert.match(
      candidate.license,
      /^https:\/\/creativecommons.org\/licenses\/by-sa\/(3|4)\.0\/$/,
    );
    assert.ok(
      candidate.author.length > 0 && candidate.alt.en && candidate.alt.sq,
    );
    assert.deepEqual(
      candidate.variants.map((variant) => variant.width),
      [640, 1200, 1920],
    );
    for (const variant of candidate.variants) {
      const file = readFileSync(variant.file);
      assert.equal(file.length, variant.bytes);
      assert.ok(file.length < 300000);
      assert.equal(
        createHash("sha256").update(file).digest("hex"),
        variant.sha256,
      );
    }
  }
});

test("Vienna itinerary keeps the Upper Belvedere identity and London supplies a Sunday exterior alternative in EN/SQ", async () => {
  const vienna = await draftContentPreview(
    destinationContentData,
    context,
    "vienna",
    now,
  );
  const london = await draftContentPreview(
    destinationContentData,
    context,
    "london",
    now,
  );
  if (vienna.status !== "reviewed" || london.status !== "reviewed")
    throw Error("preview");
  const belvedere = selectDayTemplate(
    vienna.content.dayTemplates,
    3,
  )!.stops.find((stop) => stop.attractionId === "attraction:vienna:belvedere")!;
  assert.match(belvedere.notes!.en, /^Visit Upper Belvedere/);
  assert.match(belvedere.notes!.en, /Lower Belvedere is a separate visit/);
  assert.match(belvedere.notes!.sq, /Vizito Belvedere të Sipërm/);
  assert.match(belvedere.notes!.sq, /Belvedere i Poshtëm është vizitë më vete/);
  assert.doesNotMatch(belvedere.notes!.en, /Choose Upper or Lower/);
  for (const nights of [2, 3]) {
    const abbey = selectDayTemplate(
      london.content.dayTemplates,
      nights,
    )!.stops.find((stop) => stop.attractionId.endsWith(":westminster-abbey"))!;
    assert.match(
      abbey.notes!.en,
      /On Sundays, plan an exterior Westminster walk/,
    );
    assert.match(abbey.notes!.sq, /Të dielave planifiko një shëtitje jashtë/);
  }
  const advice = london.content.attractions!.find((place) =>
    place.id.endsWith(":westminster-abbey"),
  )!.bookingAdvice!;
  assert.match(advice.en, /Sundays are for worship, not sightseeing/);
  assert.match(advice.sq, /Të dielave ka shërbesa, jo vizita turistike/);
});
