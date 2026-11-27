import { test } from "node:test";
import assert from "node:assert/strict";
import { getTripTemplates } from "../src/services/travel";
import { demoProviders } from "../src/providers/demo";
import { defaultRequest } from "./fixtures/prishtina-request";
import { pricePlan } from "../src/domain/pricing";
import type { TravelProviders } from "../src/providers/contracts";

test("image enrichment never retains a legacy fallback outside the approved store", async () => {
  const catalogue = await demoProviders.destinations.list();
  const search = await getTripTemplates(defaultRequest, {
    ...demoProviders,
    images: {
      async forDestination(id) {
        const local = catalogue.find((d) => d.id === id)!.image;
        assert.ok(local);
        return {
          ...local,
          src: "https://upload.wikimedia.org/wikipedia/commons/example.jpg",
          source: "provider",
          verification: "unverified",
        };
      },
    },
  });
  assert.ok(search.templates.length);
  const enriched = search.templates.filter((t) => t.destination.image);
  assert.equal(
    enriched.length,
    catalogue.filter((d) => !d.requiresFlight).length,
  );
  for (const { destination } of enriched) {
    assert.equal(destination.image!.source, "provider");
    assert.equal(destination.fallbackImage, undefined);
    assert.ok(destination.heroImage);
  }
});

test("provider search requests only the active origin once per destination", async () => {
  const seen: string[] = [];
  const providers: TravelProviders = {
    ...demoProviders,
    transport: {
      async quote(r, d) {
        seen.push(r.originId);
        return demoProviders.transport.quote(r, d);
      },
    },
  };
  const request = { ...defaultRequest, originId: "skopje" };
  const search = await getTripTemplates(request, providers);
  assert.equal(
    seen.length,
    (await demoProviders.destinations.list()).filter((d) => !d.requiresFlight)
      .length,
  );
  assert.deepEqual([...new Set(seen)], ["skopje"]);
  assert.ok(
    search.templates.every(
      (t) => t.origin.id === "skopje" && "mode" in t.transport,
    ),
  );
});
test("fallback quote retains failure reason and independent source status through pricing", async () => {
  const providers: TravelProviders = {
    ...demoProviders,
    transport: {
      async quote(r, d) {
        const good = await demoProviders.transport.quote(r, d);
        assert.equal(good.status, "available");
        if (good.status !== "available") throw new Error("fixture");
        return {
          status: "unavailable",
          fallback: good.value,
          reason: "provider-timeout",
        };
      },
    },
  };
  const search = await getTripTemplates(defaultRequest, providers);
  assert.ok(search.templates.length);
  const p = pricePlan(search.templates[0], defaultRequest);
  assert.equal(p.costs[0].confidence, "estimate");
  assert.deepEqual(p.costs[0].source, {
    status: "fallback",
    reason: "provider-timeout",
  });
  assert.deepEqual(search.issues[0].source, p.costs[0].source);
});
test("unavailable stay source preserves destination with an explicit generic allowance", async () => {
  const search = await getTripTemplates(defaultRequest, {
    ...demoProviders,
    stays: {
      async quote() {
        return { status: "unavailable", reason: "no-fallback" };
      },
    },
  });
  assert.ok(search.templates.length > 0);
  const plan = pricePlan(search.templates[0], defaultRequest);
  assert.equal(plan.accommodation?.kind, "generic-estimate");
  assert.ok(plan.accommodation?.quote?.amount.cents);
  assert.ok(search.issues.length);
  assert.deepEqual(search.issues[0].source, {
    status: "unavailable",
    reason: "no-fallback",
  });
});
test("stale source status and observation timestamp survive composition", async () => {
  const search = await getTripTemplates(defaultRequest, {
    ...demoProviders,
    stays: {
      async quote(r, d) {
        const good = await demoProviders.stays.quote(r, d);
        if (good.status !== "available") throw new Error("fixture");
        return { status: "stale", value: good.value, reason: "refresh-failed" };
      },
    },
  });
  assert.deepEqual(search.templates[0].stay.source, {
    status: "stale",
    reason: "refresh-failed",
  });
  assert.equal(search.templates[0].stay.confidence, "recent");
  assert.equal(search.templates[0].stay.observedAt, "2026-10-05T08:00:00Z");
});
test("thrown quote failures are normalized and preserved as unavailable", async () => {
  const search = await getTripTemplates(
    defaultRequest,
    {
      ...demoProviders,
      transport: {
        async quote() {
          throw new Error("private upstream response");
        },
      },
    },
    "crete",
  );
  assert.ok(search.templates.length > 0);
  assert.ok(
    search.templates.every(
      (t) =>
        t.transport.mode === "flight" &&
        pricePlan(t, defaultRequest).pricingCompleteness === "flight-unpriced",
    ),
  );
  assert.equal(search.issues[0].source.status, "unavailable");
  assert.equal(JSON.stringify(search).includes("private upstream"), false);
});
