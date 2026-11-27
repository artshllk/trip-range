import { test } from "node:test";
import assert from "node:assert/strict";
import { CHILD_INPUT, renderInChild } from "./child-render";
import type { ImageAssetBoundary } from "../src/components/travel/DestinationImage";
import type { ImageAttribution } from "../src/components/travel/Provenance";
import {
  trustedDestinationImage,
  displayedDestinationImage,
} from "../src/domain/destination-images";
import {
  trustedImageFixture,
  pigeonImageFixture,
  flowerImageFixture,
} from "./destination-image-fixtures";
import { createTravelProviders } from "../src/providers/server/composition";
import { createDestinationImages } from "../src/providers/server/images";
import { demoProviders } from "../src/providers/demo";
import { getTripTemplates } from "../src/services/travel";
import { defaultRequest } from "../src/domain/request";
import { pricePlan } from "../src/domain/pricing";
import { curate } from "../src/domain/ranking";
import en from "../src/i18n/en.json";

function render(
  image: Parameters<typeof ImageAssetBoundary>[0]["image"],
  id = "city:LON",
) {
  const props: Omit<Parameters<typeof ImageAssetBoundary>[0], "children"> = {
    image,
    destination: {
      id,
      name: { en: id === "crete" ? "Crete" : "London", sq: "" },
    },
    locale: "en",
  };
  const credit: Parameters<typeof ImageAttribution>[0] = { t: en };
  return renderInChild(
    `
    const {createElement: h} = require('react');
    const {renderToStaticMarkup} = require('react-dom/server');
    const {ImageAssetBoundary,DestinationImage,WhenDestinationPhoto} = require('./.test-build/src/components/travel/DestinationImage.js');
    const {ImageAttribution} = require('./.test-build/src/components/travel/Provenance.js');
    const {props,credit} = ${CHILD_INPUT};
    process.stdout.write(renderToStaticMarkup(h(ImageAssetBoundary,props,
      h(DestinationImage,{fallbackAlt:'Destination photo',width:340,height:220}),
      h(WhenDestinationPhoto,null,h('aside',{className:'credit'},h(ImageAttribution,credit))))));
  `,
    { props, credit },
  );
}

for (const [name, asset, id] of [
  ["London pigeon", pigeonImageFixture, "city:LON"],
  ["Crete flower", flowerImageFixture, "crete"],
] as const) {
  test(`${name}: unverified candidate never renders a photo, source URL, preload or attribution`, () => {
    assert.equal(trustedDestinationImage(asset, id), false);
    const html = render(asset, id);
    assert.match(html, /destination-no-image/);
    assert.match(html, /Destination photo unavailable/);
    assert.doesNotMatch(
      html,
      /<img|<link|class="credit"|upload.wikimedia|photographer|licence|licens/i,
    );
  });
}
test("verified destination-bound local raster renders with escaped attribution", () => {
  const html = render({
    ...trustedImageFixture,
    author: "Photographer <script>",
  });
  assert.match(html, /<img/);
  assert.match(html, /qa-trusted/);
  assert.match(html, /Photographer &lt;script&gt;/);
  assert.match(html, /Synthetic test licence/);
  assert.doesNotMatch(html, /destination-no-image|Illustrative photo/);
});
test("missing images have no img or empty attribution control", () => {
  for (const image of [null, undefined]) {
    const html = render(image);
    assert.match(html, /destination-no-image/);
    assert.doesNotMatch(html, /<img|class="credit"/);
  }
});
test("automatic unverified Pexels selection cannot render despite complete attribution", () => {
  const image = {
    ...pigeonImageFixture,
    src: "https://images.pexels.com/photos/12345/pexels-photo-12345.jpeg",
    sourceId: "pexels:12345",
    photoUrl: "https://www.pexels.com/photo/test-12345/",
    authorUrl: "https://www.pexels.com/@test/",
    license: "https://www.pexels.com/license/",
  };
  assert.equal(trustedDestinationImage(image, "city:LON"), false);
  const html = render(image);
  assert.match(html, /destination-no-image/);
  assert.doesNotMatch(html, /<img|<link|pexels|class="credit"/);
});
test("verification must match the destination; brand imagery and unsafe assets are rejected", () => {
  assert.equal(trustedDestinationImage(trustedImageFixture, "crete"), false);
  for (const patch of [
    { verification: "illustrative" as const },
    { source: "design-reference" as const },
    { src: "/demo/van-portrait.png" },
    { src: "/destinations/file.svg" },
    { src: "//evil.test/a.png" },
    { src: "/destinations/../file.png" },
    { src: "data:image/svg+xml,test" },
    { destinationId: null },
  ])
    assert.equal(
      trustedDestinationImage({ ...trustedImageFixture, ...patch }, "city:LON"),
      false,
    );
});
test("stored verified provider metadata still requires safe raster hosts and licensing links", () => {
  const asset = { ...pigeonImageFixture, verification: "verified" as const };
  assert.equal(trustedDestinationImage(asset, "city:LON"), true);
  for (const patch of [
    { src: asset.src.replace("https:", "http:") },
    { src: asset.src + "?redirect=unsafe" },
    { src: asset.src.replace("upload.wikimedia.org", "evil.test") },
    { src: asset.src.replace(".jpg", ".svg") },
    { photoUrl: "javascript:alert(1)" },
    { license: null },
    { license: "https://evil.test/" },
    { author: "" },
  ])
    assert.equal(
      trustedDestinationImage({ ...asset, ...patch }, "city:LON"),
      false,
    );
});
test("image load failure never selects a generic or unverified alternate and cannot loop", () => {
  assert.equal(
    displayedDestinationImage(
      trustedImageFixture,
      pigeonImageFixture,
      "city:LON",
      [trustedImageFixture.src],
    ),
    undefined,
  );
  const alternate = {
    ...trustedImageFixture,
    src: "/destinations/alternate.jpg",
  };
  assert.equal(
    displayedDestinationImage(trustedImageFixture, alternate, "city:LON", [
      trustedImageFixture.src,
    ]),
    alternate,
  );
  assert.equal(
    displayedDestinationImage(trustedImageFixture, alternate, "city:LON", [
      trustedImageFixture.src,
      alternate.src,
    ]),
    undefined,
  );
});
test("ordinary runtime composition makes zero Commons/geosearch/Pexels requests, even with keys and coordinates", async () => {
  let calls = 0;
  const providers = await createTravelProviders(
    { PEXELS_API_KEY: "synthetic-image-key" },
    async () => {
      calls++;
      throw Error("provider failure");
    },
  );
  const catalogue = await providers.destinations.list();
  for (const destination of catalogue) {
    destination.coordinates = { latitude: 51.5, longitude: -0.1 };
    await providers.images.forDestination(destination.id);
  }
  const trusted = {
    ...catalogue[0],
    id: "city:LON",
    image: trustedImageFixture,
  };
  assert.equal(
    await createDestinationImages([trusted]).forDestination(trusted.id),
    undefined,
  );
  assert.equal(calls, 0);
});
test("image rejection or provider failure never changes pricing or ranking", async () => {
  const normal = await getTripTemplates(defaultRequest, demoProviders);
  for (const images of [
    {
      forDestination: async () => {
        throw Error("image provider failed");
      },
    },
    { forDestination: async () => pigeonImageFixture },
  ]) {
    const result = await getTripTemplates(defaultRequest, {
      ...demoProviders,
      images,
    });
    const digest = (templates: typeof result.templates) => {
      const plans = templates.map((p) => pricePlan(p, defaultRequest));
      return {
        prices: plans.map((p) => ({
          id: p.id,
          costs: p.costs,
          budget: p.budget,
          ceiling: p.flightAffordability,
        })),
        order: curate(plans, defaultRequest).cards.map((p) => p.id),
      };
    };
    assert.deepEqual(digest(result.templates), digest(normal.templates));
  }
});

test("licensed local Commons derivatives retain source, licence and modification disclosure", () => {
  const html = render({
    ...trustedImageFixture,
    src: "/destinations/london-1200.webp",
    source: "local",
    sourceId: "local:commons-london",
    attribution: "Photographer · resized WebP · CC BY-SA 3.0",
    license: "https://creativecommons.org/licenses/by-sa/3.0/",
    photoUrl: "https://commons.wikimedia.org/wiki/File:London_Skyline.jpeg",
  });
  assert.match(
    html,
    /href="https:\/\/commons.wikimedia.org\/wiki\/File:London_Skyline.jpeg"/,
  );
  assert.match(
    html,
    /href="https:\/\/creativecommons.org\/licenses\/by-sa\/3.0\/"/,
  );
  assert.match(html, /rel="noopener noreferrer"/);
  assert.ok(html.includes(en.imageCropped));
  const unsafe = render({
    ...trustedImageFixture,
    src: "/destinations/london.webp",
    source: "local",
    photoUrl: "javascript:alert(1)",
    license: "https://creativecommons.org/licenses/by-sa/3.0/",
  });
  assert.doesNotMatch(unsafe, /href="javascript:/);
});

const localResponsiveFixture = {
  ...trustedImageFixture,
  src: "/destinations/fixture-city-1200.webp",
  localVariants: [
    { src: "/destinations/fixture-city-640.webp", width: 640, height: 427 },
    { src: "/destinations/fixture-city-1200.webp", width: 1200, height: 800 },
    { src: "/destinations/fixture-city-1920.webp", width: 1920, height: 1280 },
  ],
};

test("pre-optimized local images render true width descriptors, caller dimensions and generic destination identity", () => {
  const image = {
    ...localResponsiveFixture,
    destinationId: "place:other-reviewed-city",
  };
  assert.equal(
    trustedDestinationImage(image, "place:other-reviewed-city"),
    true,
  );
  const html = render(image, "place:other-reviewed-city");
  assert.match(
    html,
    /srcSet="\/destinations\/fixture-city-640.webp 640w, \/destinations\/fixture-city-1200.webp 1200w, \/destinations\/fixture-city-1920.webp 1920w"/,
  );
  assert.match(html, /sizes="340px"/);
  assert.match(html, /width="340" height="220"/);
  assert.doesNotMatch(html, /_next\/image/);
  assert.equal(trustedDestinationImage(image, "city:LON"), false);
  assert.equal(
    trustedDestinationImage(
      { ...image, verification: "unverified" },
      image.destinationId,
    ),
    false,
  );
});

test("local variant declarations fail closed on unsafe, mixed, duplicate or inconsistent image data", () => {
  const invalid = [
    [],
    [localResponsiveFixture.localVariants[0]],
    localResponsiveFixture.localVariants.slice().reverse(),
    [
      ...localResponsiveFixture.localVariants,
      localResponsiveFixture.localVariants[2],
    ],
    localResponsiveFixture.localVariants.map((variant, i) =>
      i === 0
        ? { ...variant, src: "https://evil.example/other.webp" }
        : variant,
    ),
    localResponsiveFixture.localVariants.map((variant, i) =>
      i === 0
        ? { ...variant, src: "/destinations/other-city-640.webp" }
        : variant,
    ),
    localResponsiveFixture.localVariants.map((variant, i) =>
      i === 0 ? { ...variant, width: 600 } : variant,
    ),
    localResponsiveFixture.localVariants.map((variant, i) =>
      i === 0 ? { ...variant, height: 640 } : variant,
    ),
    localResponsiveFixture.localVariants.filter(
      (variant) => variant.width !== 1200,
    ),
  ];
  for (const localVariants of invalid) {
    const asset = { ...localResponsiveFixture, localVariants };
    assert.equal(trustedDestinationImage(asset, "city:LON"), false);
    assert.match(render(asset), /destination-no-image/);
  }
  assert.equal(
    trustedDestinationImage(
      {
        ...pigeonImageFixture,
        verification: "verified",
        localVariants: localResponsiveFixture.localVariants,
      },
      "city:LON",
    ),
    false,
  );
});
