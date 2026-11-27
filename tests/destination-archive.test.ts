import {
  currentEditorialNow,
  currentContentAtApproval as approvedDestinationContent,
} from "./fixtures/current-editorial-data";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import archive from "../content/archive/cost-scope-2026-11-02/manifest.json";
import policy from "../src/config/archived-destinations.json";
import { destinationContentData } from "../content/destinations/records";
import { destinationAccessData } from "../content/travel/access/records";
import { destinationAccess } from "../src/travel/runtime/access";
import { loadContentOperations } from "../scripts/lib/content-operations";
import { loadEditorialWorkspace } from "../scripts/lib/editorial-workspace";
import { editorialMaintenance } from "../scripts/lib/editorial-maintenance";
import { travelMaintenance } from "../scripts/lib/travel-maintenance";
import { destinationCollection } from "../src/domain/destination-discovery";
import {
  destinationGuideTarget,
  loadDestinationGuide,
  getDestinationGuides,
} from "../src/services/destination-guides";
import { destinationSitemap } from "../src/seo/destinations";
import { createTravelProviders } from "../src/providers/server/composition";
import {
  destinationMetadata,
  createDestinationResolver,
} from "../src/providers/server/destination-resolver";
import { getTripTemplates } from "../src/services/travel";
import { defaultRequestFor } from "../src/domain/request";

const ids = new Set(archive.records.map((r) => r.id));
const now = currentEditorialNow();

test("all 20 archives retain exact original bytes and have no live content/access/approval record", async () => {
  assert.equal(ids.size, 20);
  assert.deepEqual(new Set(policy.records.map((r) => r.id)), ids);
  for (const r of archive.records) {
    assert.equal(r.files.length, 3);
    for (const f of r.files) {
      assert.equal(existsSync(f.from), false, f.from);
      assert.equal(
        createHash("sha256").update(readFileSync(f.to)).digest("hex"),
        f.sha256,
      );
    }
    assert.equal(
      destinationContentData.records.some((d) => d.destinationId === r.id),
      false,
    );
    assert.equal(
      destinationAccessData.records.some((d) => d.destinationSubject === r.id),
      false,
    );
    assert.equal((await approvedDestinationContent.get(r.id)).status, "none");
    assert.equal(destinationAccess.get(r.id), undefined);
    assert.equal(destinationGuideTarget(r.id), undefined);
  }
  assert.equal(destinationContentData.records.length, 7);
  assert.deepEqual(archive.firstExpansionCandidates.sort(), [
    "place:Q101625",
    "place:Q612",
  ]);
});

test("archived destinations are absent from operator work and every scheduled maintenance row", () => {
  const operations = loadContentOperations();
  assert.equal(operations.data.records.length, 7);
  for (const r of [...operations.queue, ...operations.research])
    assert.equal(ids.has(r.destinationId), false);
  const workspace = loadEditorialWorkspace(undefined, operations, now);
  assert.equal(workspace.inputs.size, 7);
  assert.equal(workspace.reviews.size, 7);
  for (const r of editorialMaintenance(workspace, 365).rows)
    assert.equal(ids.has(r.destinationId), false);
  for (const r of travelMaintenance(365, now))
    assert.equal(
      [...ids].some((id) => r.id === id || r.id.startsWith(`${id}:`)),
      false,
    );
});

test("live discovery and English sitemap expose only retained published guides", async () => {
  assert.deepEqual(
    destinationCollection.map((r) => r.slug),
    ["vienna", "london", "paris", "istanbul", "barcelona"],
  );
  for (const slug of [
    "new-york",
    "singapore",
    "mexico-city",
    "tokyo",
    "kyoto",
    "bangkok",
    "marrakesh",
    "cape-town",
    "rio-de-janeiro",
    "sydney",
    "dubai",
  ])
    assert.equal(await loadDestinationGuide(slug), undefined, slug);
  const guides = await getDestinationGuides();
  assert.equal(guides.length, 5);
  assert.equal(
    guides.some((g) => ids.has(g.card.subject)),
    false,
  );
  // Noindex under the G1–G4 gate: no guide, archived or not, enters the sitemap.
  assert.deepEqual(
    destinationSitemap(guides.map((g) => ({ card: g.card }))),
    [],
  );
});

test("production restoration cannot revive any archived identity or direct airport alias", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    throw Error("Archived restoration must not request metadata or fares");
  };
  for (const r of policy.records) {
    for (const id of [r.id, ...r.directCodes.map((c) => `city:${c}`)]) {
      const request = {
        ...defaultRequestFor("2026-11-02"),
        destination: {
          id,
          type: "city" as const,
          name: r.name,
          countryCode: r.countryCode,
          countryName: { en: r.countryCode, sq: r.countryCode },
          ...(id.startsWith("city:") ? { cityCode: id.slice(5) } : {}),
        },
      };
      const providers = await createTravelProviders(
        {},
        fetcher,
        false,
        request,
      );
      const result = await getTripTemplates(request, providers, id);
      assert.deepEqual(result.templates, [], id);
    }
  }
  assert.equal(calls, 0);
});

test("provider metadata and broad discovery aliases cannot recreate archived cities", async () => {
  let calls = 0;
  const resolver = createDestinationResolver([], async () => {
    calls++;
    throw Error("No archive lookup");
  });
  assert.deepEqual(
    await resolver.resolve(policy.records.flatMap((r) => r.directCodes)),
    [],
  );
  assert.equal(calls, 0);
  for (const r of policy.records) {
    // A different code cannot evade exact identity/name/country exclusion.
    assert.equal(
      destinationMetadata(
        [
          {
            type: "city",
            code: "ZZZ",
            name: r.name,
            country_code: r.countryCode,
            country_name: r.countryCode,
          },
        ],
        "ZZZ",
      ),
      undefined,
    );
  }
  assert.ok(
    destinationMetadata(
      [
        {
          type: "city",
          code: "VIE",
          name: "Vienna",
          country_code: "AT",
          country_name: "Austria",
        },
      ],
      "VIE",
    ),
  );
});
