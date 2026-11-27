import {
  currentEditorialNow,
  currentContentAtApproval as approvedDestinationContent,
} from "./fixtures/current-editorial-data";
import { test } from "node:test";
import { createTravelpayoutsDiscovery } from "./flight-provider-fixture";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import parked from "../src/config/parked-destinations.json";
import manifest from "../content/parked/launch-2026-11-02/manifest.json";
import {
  defaultRequestFor,
  originResolution,
  parseRequest,
  requestQuery,
} from "../src/domain/request";
import { homepageRequest } from "../src/domain/destination-discovery";
import { findLocation } from "../src/catalogue/locations";
import { createTravelProviders } from "../src/providers/server/composition";
import {
  createDestinationResolver,
  destinationMetadata,
} from "../src/providers/server/destination-resolver";
import { getTripTemplates } from "../src/services/travel";
import { getDemoImageTemplates } from "../src/services/app-travel";
import { destinationContentData } from "../content/destinations/records";
import { destinationAccess } from "../src/travel/runtime/access";
import { loadContentOperations } from "../scripts/lib/content-operations";
import { loadEditorialWorkspace } from "../scripts/lib/editorial-workspace";
import { editorialMaintenance } from "../scripts/lib/editorial-maintenance";
import { travelMaintenance } from "../scripts/lib/travel-maintenance";
import { launchReadiness } from "../src/config/readiness";
import { validateEnvironment } from "../src/config/environment";
import {
  isInactiveDestination,
  isExcludedTravelDestination,
} from "../src/domain/destination-lifecycle";

const today = "2026-11-02";
const noFetch: typeof fetch = async () =>
  assert.fail("No external collection in a launch-scope test");

test("Tirana visibly prefills a new search; explicit origins and missing-origin protection survive", () => {
  assert.equal(homepageRequest({}, today).originId, "tirana");
  assert.equal(defaultRequestFor(today).originId, "tirana");
  assert.equal(findLocation("tirana")?.iataCodes?.[0], "TIA");
  assert.equal(
    homepageRequest({ origin: "prishtina" }, today).originId,
    "prishtina",
  );
  assert.equal(homepageRequest({ origin: "skopje" }, today).originId, "skopje");
  assert.equal(
    homepageRequest({ origin: "unknown-place" }, today).originId,
    "",
  );
  assert.equal(homepageRequest({ originPlace: "broken" }, today).originId, "");
  assert.equal(originResolution({}), "missing");
  const request = homepageRequest({}, today);
  assert.equal(
    parseRequest(Object.fromEntries(new URLSearchParams(requestQuery(request))))
      .originId,
    "tirana",
  );
});

test("all parked identities and direct aliases are excluded before production restoration or metadata lookup", async () => {
  assert.equal(parked.records.length, 6);
  for (const row of parked.records) {
    for (const id of [row.id, ...row.directCodes.map((c) => `city:${c}`)]) {
      const request = {
        ...defaultRequestFor(today),
        destination: {
          id,
          type: "city" as const,
          name: row.name,
          countryCode: row.countryCode,
          countryName: { en: row.countryCode, sq: row.countryCode },
          ...(id.startsWith("city:") ? { cityCode: id.slice(5) } : {}),
        },
      };
      const providers = await createTravelProviders(
        {},
        noFetch,
        false,
        request,
      );
      assert.equal(
        (await providers.destinations.list()).some(isInactiveDestination),
        false,
      );
      assert.deepEqual(
        (await getTripTemplates(request, providers, id)).templates,
        [],
        id,
      );
    }
    assert.equal(
      destinationMetadata(
        [
          {
            type: "city",
            code: "ZZZ",
            name: row.name,
            country_code: row.countryCode,
            country_name: row.countryCode,
          },
        ],
        "ZZZ",
      ),
      undefined,
    );
  }
  assert.deepEqual(
    await createDestinationResolver([], noFetch).resolve(
      parked.records.flatMap((r) => r.directCodes),
    ),
    [],
  );
  assert.deepEqual(
    (await getDemoImageTemplates(defaultRequestFor(today), ["crete"]))
      .templates,
    [],
  );
});

test("parking retains exact content bytes and removes publication, access and review work", async () => {
  const ids = new Set(parked.records.map((r) => r.id));
  let retained = 0;
  for (const record of manifest.records) {
    for (const file of record.files) {
      assert.equal(existsSync(file.from), false);
      assert.equal(
        createHash("sha256").update(readFileSync(file.to)).digest("hex"),
        file.sha256,
      );
      retained++;
    }
    assert.equal(
      (await approvedDestinationContent.get(record.id)).status,
      "none",
    );
    assert.equal(destinationAccess.get(record.id), undefined);
  }
  assert.equal(retained, 8);
  for (const path of manifest.researchFilesRetainedInPlace)
    assert.ok(existsSync(path));
  assert.equal(destinationContentData.records.length, 7);
  const operations = loadContentOperations();
  assert.equal(
    operations.queue.some((r) => ids.has(r.destinationId)),
    false,
  );
  assert.equal(
    operations.research.some((r) => ids.has(r.destinationId)),
    false,
  );
  const now = currentEditorialNow();
  const workspace = loadEditorialWorkspace(undefined, operations, now);
  assert.equal(workspace.inputs.size, 7);
  assert.equal(
    editorialMaintenance(workspace, 365).rows.some((r) =>
      ids.has(r.destinationId),
    ),
    false,
  );
  assert.equal(
    travelMaintenance(365, now).some((r) => ids.has(r.id)),
    false,
  );
});

test("Prishtina remains content and an origin, while origin-only and parked places cannot be destination results", async () => {
  assert.equal(
    (await approvedDestinationContent.get("prishtina")).status,
    "reviewed",
  );
  assert.ok(
    loadEditorialWorkspace(
      undefined,
      undefined,
      currentEditorialNow(),
    ).inputs.has("prishtina"),
  );
  for (const originId of ["tirana", "prishtina", "skopje"]) {
    const request = { ...defaultRequestFor(today), originId };
    const providers = await createTravelProviders({}, noFetch, false, request);
    // Explicit synthetic matching fare proves all three origin paths remain usable.
    // Keyless production correctly returns no trips, so an empty catalogue check
    // alone would not prove this property.
    const originCode = findLocation(originId)!.iataCodes![0];
    providers.discovery = createTravelpayoutsDiscovery(
      "synthetic-launch-scope",
      async () =>
        Response.json({
          success: true,
          currency: "EUR",
          data: [
            {
              origin: originCode,
              destination: "VIE",
              price: 100,
              departure_at: `${request.dates.startDate}T10:00:00Z`,
              return_at: `${request.dates.endDate}T18:00:00Z`,
              transfers: 0,
              airline: "XX",
              found_at: "2026-11-02T11:00:00Z",
            },
          ],
        }),
      () => new Date("2026-11-02T12:00:00Z"),
    );
    assert.ok(await providers.locations.get(originId));
    assert.equal(
      (await providers.destinations.list()).some(isExcludedTravelDestination),
      false,
    );
    const result = await getTripTemplates(request, providers, "vienna");
    assert.ok(
      result.templates.length > 0,
      `${originId} remains a usable origin`,
    );
    assert.ok(result.templates.every((t) => t.origin.id === originId));
    assert.equal(
      result.templates.some((t) => isExcludedTravelDestination(t.destination)),
      false,
    );
  }
});

test("public launch uses the approved evidence tiers and still requires sustained fare coverage", () => {
  const report = launchReadiness(validateEnvironment({}));
  assert.equal(
    report.manual.includes(
      "launch-destination-content-and-cost-validation-pending",
    ),
    false,
  );
  assert.ok(report.manual.includes("fare-coverage-streak-unverified"));
  assert.equal(report.ready, false);
});
