import { test } from "node:test";
import assert from "node:assert/strict";
import barcelona from "./fixtures/editorial-baseline-2026-11-02/content/destinations/barcelona.json";
import type { DestinationContent } from "../src/domain/destination-content/types";
import { guideExpiryAlerts } from "../scripts/lib/destination-expiry-audit";

test("Park Güell warns at seven days and names both lost itineraries", async () => {
  const city = barcelona as DestinationContent;
  const park = city.attractions!.find((a) => a.id.endsWith(":park-guell"))!;
  assert(park.freshness.kind === "volatile");
  const threshold = Date.parse(park.freshness.validUntil) - 7 * 86400000;
  const parkAlert = async (clock: number) =>
    (await guideExpiryAlerts([city], clock)).find((line) =>
      line.includes(park.id),
    );
  assert.equal(await parkAlert(threshold - 1), undefined);
  const warning = await parkAlert(threshold);
  assert.ok(warning);
  assert.ok(warning.includes("barcelona") && warning.includes("Park Güell"));
  for (const template of city.dayTemplates!)
    assert.ok(warning.includes(template.title.en));
  assert.ok(warning.includes("displayed day outline"));
  assert.deepEqual(
    await guideExpiryAlerts([{ ...city, reviewStatus: "draft" }], threshold),
    [],
  );
});
