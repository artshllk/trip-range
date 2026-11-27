import { contentItems } from "../../src/content/integrity";
import type { DestinationContent } from "../../src/domain/destination-content/types";

import { destinationCollection } from "../../src/domain/destination-discovery";
import { selectDayTemplate } from "../../src/content/presentation";
import { createPinnedDestinationContentStore } from "../../src/content/runtime/publication";
import { destinationContentValidationContext } from "../../src/content/runtime/approved";
import type { DestinationContentResult } from "../../src/domain/destination-content/types";

/** Audit every reviewable section with the same freshness selectors as runtime. */
export function destinationContentDeadlines(record: DestinationContent) {
  return contentItems(record).flatMap(({ id, item }) => {
    const freshness = item.freshness;
    if (freshness.kind === "stable") return [];
    return [
      {
        id,
        date:
          freshness.kind === "periodically-reviewed"
            ? freshness.reviewBy
            : freshness.validUntil,
      },
    ];
  });
}

const week = 7 * 24 * 60 * 60 * 1000;

function guideContent(result: DestinationContentResult) {
  if (result.status !== "reviewed") return;
  const c = result.content;
  if (
    c.overview?.text.en.trim() &&
    (c.attractions?.length ?? 0) >= 3 &&
    c.sources.length
  )
    return c;
}

function itemLabel(record: DestinationContent, id: string) {
  const entries = [
    ...(record.attractions ?? []),
    ...(record.areas ?? []),
    ...(record.transport ?? []),
    ...(record.dayTemplates ?? []),
    ...(record.practicalNotes ?? []),
    ...(record.highlights ?? []),
  ];
  const item = entries.find((entry) => entry.id === id);
  if (!item) return id;
  if ("name" in item) return item.name.en;
  if ("title" in item) return item.title.en;
  return item.text.en;
}

/** Replay the actual publication filter across each deadline, including simultaneous expiries. */
export async function guideExpiryAlerts(
  records: DestinationContent[],
  now: number,
) {
  const alerts: string[] = [];
  for (const record of records) {
    const guide = destinationCollection.find(
      (entry) => entry.subject === record.destinationId,
    );
    if (!guide || record.reviewStatus !== "reviewed") continue;
    const due = destinationContentDeadlines(record).filter(
      ({ date }) => Date.parse(date) > now && Date.parse(date) <= now + week,
    );
    if (!due.length) continue;
    let clock = now;
    const store = createPinnedDestinationContentStore(
      { schemaVersion: 1, records: [record] },
      destinationContentValidationContext,
      () => clock,
    );
    const read = async (time: number) => {
      clock = time;
      return guideContent(await store.get(record.destinationId));
    };
    if (!(await read(now))) continue;
    for (const date of new Set(due.map((entry) => entry.date))) {
      const before = await read(Date.parse(date) - 1);
      if (!before) continue;
      const after = await read(Date.parse(date));
      const visible = new Set(contentItems(before).map(({ id }) => id));
      const survivingDays = new Set(after?.dayTemplates?.map((day) => day.id));
      for (const entry of due.filter(
        (entry) => entry.date === date && visible.has(entry.id),
      )) {
        const lost = (before.dayTemplates ?? []).filter(
          (day) =>
            !survivingDays.has(day.id) &&
            day.stops.some((stop) => stop.attractionId === entry.id),
        );
        const effects = lost.map((day) => day.title.en);
        const outline = selectDayTemplate(before.dayTemplates, 2);
        if (
          outline &&
          !selectDayTemplate(after?.dayTemplates, 2) &&
          (outline.id === entry.id || lost.some((day) => day.id === outline.id))
        )
          effects.push("displayed day outline");
        if (!after) effects.push("guide page and directory listing");
        alerts.push(
          `${guide.slug} — ${itemLabel(before, entry.id)} [${entry.id}] disappears at ${date}${effects.length ? ". Also lost: " + effects.join(", ") : ""}`,
        );
      }
    }
  }
  return alerts;
}
