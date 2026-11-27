import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createWikimediaImages,
  COMMONS_CACHE_SECONDS,
  COMMONS_USER_AGENT,
} from "../src/providers/server/wikimedia";
import { createImageCandidateDiscovery } from "../src/providers/server/image-candidates";
import { demoProviders } from "../src/providers/demo";
import type { ProviderFetch } from "../src/providers/server/http";
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const meta = (value: string) => ({ value });
const page = {
  pageid: 123,
  ns: 6,
  index: 1,
  title: "File:Mirusha waterfalls Kosovo.jpg",
  imageinfo: [
    {
      url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Mirusha.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original",
      descriptionurl:
        "https://commons.wikimedia.org/wiki/File:Mirusha_waterfalls_Kosovo.jpg",
      width: 2400,
      height: 1600,
      size: 123456,
      mime: "image/jpeg",
      mediatype: "BITMAP",
      extmetadata: {
        Artist: meta(
          '<a href="//commons.wikimedia.org/wiki/User:Photographer">A &amp; B</a>',
        ),
        LicenseShortName: meta("CC BY-SA 4.0"),
        LicenseUrl: meta("https://creativecommons.org/licenses/by-sa/4.0"),
        ImageDescription: meta("Mirusha Waterfalls in Kosovo"),
        Credit: meta("Own work"),
        Restrictions: meta(""),
      },
    },
  ],
};
const body = { batchcomplete: true, query: { pages: [page] } };
async function destination() {
  const d = (await demoProviders.destinations.list()).find(
    (d) => d.id === "mirusha",
  )!;
  return { ...d, image: { ...d.image! } };
}

function changeMetadata(patch: Record<string, { value: string } | undefined>) {
  return {
    ...page,
    imageinfo: [
      {
        ...page.imageinfo[0],
        extmetadata: { ...page.imageinfo[0].extmetadata, ...patch },
      },
    ],
  };
}

test("Commons exact destination search is keyless, bounded, cached and identifies GoEksplo", async () => {
  const d = await destination();
  let calls = 0;
  const fetcher: ProviderFetch = async (url, options) => {
    calls++;
    const u = new URL(url);
    assert.equal(u.hostname, "commons.wikimedia.org");
    assert.equal(u.searchParams.get("gsrsearch"), "Mirusha Waterfalls Kosovo");
    assert.equal(u.searchParams.get("gsrnamespace"), "6");
    assert.equal(u.searchParams.get("gsrlimit"), "5");
    assert.equal(
      u.searchParams.get("iiprop"),
      "url|size|mime|mediatype|extmetadata",
    );
    assert.equal(
      new Headers(options.headers).get("User-Agent"),
      COMMONS_USER_AGENT,
    );
    assert.equal(new Headers(options.headers).has("Authorization"), false);
    assert.equal(options.cache, "force-cache");
    assert.equal(options.next?.revalidate, COMMONS_CACHE_SECONDS);
    return response(body);
  };
  const image = await createWikimediaImages([d], fetcher).forDestination(d.id);
  assert.equal(calls, 1);
  assert.equal(image.source, "provider");
  assert.equal(image.sourceId, "wikimedia-commons:123");
  assert.equal(image.verification, "unverified");
  assert.equal(
    image.src,
    "https://upload.wikimedia.org/wikipedia/commons/a/ab/Mirusha.jpg",
  );
  assert.equal(image.photoUrl, page.imageinfo[0].descriptionurl);
  assert.equal(image.author, "A & B");
  assert.equal(
    image.license,
    "https://creativecommons.org/licenses/by-sa/4.0/",
  );
  assert.match(image.attribution, /Own work/);
  assert.match(image.attribution, /CC BY-SA 4.0/);
  assert.equal(image.attribution.includes("<a"), false);
});
test("Commons supports specific catalogue query overrides", async () => {
  const d = {
    ...(await destination()),
    imageQuery: "Mirusha Waterfalls Kosovo landscape",
  };
  await createWikimediaImages([d], async (url) => {
    assert.equal(new URL(url).searchParams.get("gsrsearch"), d.imageQuery);
    return response(body);
  }).forDestination(d.id);
});
for (const [name, patch] of Object.entries({
  missing: { LicenseUrl: meta("") },
  unsafe: { LicenseUrl: meta("https://evil.example/licenses/by-sa/4.0/") },
  noncommercial: {
    LicenseShortName: meta("CC BY-NC 4.0"),
    LicenseUrl: meta("https://creativecommons.org/licenses/by-nc/4.0/"),
  },
  noDerivatives: {
    LicenseShortName: meta("CC BY-ND 4.0"),
    LicenseUrl: meta("https://creativecommons.org/licenses/by-nd/4.0/"),
  },
  contradictory: { LicenseShortName: meta("All rights reserved") },
  restrictions: { Restrictions: meta("personality rights") },
  missingAuthor: { Artist: meta("") },
  ambiguousPublicDomain: {
    LicenseShortName: meta("Public domain"),
    LicenseUrl: meta(""),
  },
}))
  test(`Commons rejects ${name} license/credit metadata`, async () => {
    const d = await destination();
    const image = await createWikimediaImages([d], async () =>
      response({ query: { pages: [changeMetadata(patch)] } }),
    ).forDestination(d.id);
    assert.equal(image.src, d.image!.src);
    assert.equal(image.sourceStatus?.status, "fallback");
  });
test("CC0 HTTP deed links normalize to secure canonical terms", async () => {
  const d = await destination();
  const image = await createWikimediaImages([d], async () =>
    response({
      query: {
        pages: [
          changeMetadata({
            LicenseShortName: meta("CC0"),
            LicenseUrl: meta(
              "http://creativecommons.org/publicdomain/zero/1.0/deed.en",
            ),
          }),
        ],
      },
    }),
  ).forDestination(d.id);
  assert.equal(
    image.license,
    "https://creativecommons.org/publicdomain/zero/1.0/",
  );
  assert.equal(image.source, "provider");
});
test("Commons skips unrelated images, portraits, maps and unsafe original hosts", async () => {
  const d = await destination();
  for (const candidate of [
    {
      ...page,
      title: "File:Paris.jpg",
      imageinfo: [
        {
          ...page.imageinfo[0],
          extmetadata: {
            ...page.imageinfo[0].extmetadata,
            ImageDescription: meta("Paris France"),
          },
        },
      ],
    },
    {
      ...page,
      imageinfo: [{ ...page.imageinfo[0], width: 1000, height: 2000 }],
    },
    { ...page, title: "File:Mirusha map.jpg" },
    {
      ...page,
      imageinfo: [
        { ...page.imageinfo[0], url: "https://evil.example/image.jpg" },
      ],
    },
    { ...page, imageinfo: [{ ...page.imageinfo[0], mime: "image/svg+xml" }] },
  ]) {
    const image = await createWikimediaImages([d], async () =>
      response({ query: { pages: [candidate, page] } }),
    ).forDestination(d.id);
    assert.equal(
      image.src,
      "https://upload.wikimedia.org/wikipedia/commons/a/ab/Mirusha.jpg",
    );
  }
});
test("coordinates enable one geographic fallback, with the same relevance/license gates", async () => {
  const d = {
    ...(await destination()),
    coordinates: { latitude: 42.524, longitude: 20.572 },
  };
  let calls = 0;
  const image = await createWikimediaImages([d], async (url) => {
    const u = new URL(url);
    calls++;
    if (calls === 1) return response({ batchcomplete: true });
    assert.equal(u.searchParams.get("generator"), "geosearch");
    assert.equal(u.searchParams.get("ggscoord"), "42.524|20.572");
    assert.equal(u.searchParams.get("ggsradius"), "5000");
    assert.equal(u.searchParams.get("ggsnamespace"), "6");
    assert.equal(u.searchParams.get("ggslimit"), "5");
    return response(body);
  }).forDestination(d.id);
  assert.equal(calls, 2);
  assert.equal(image.source, "provider");
  assert.equal(image.verification, "unverified");
});
test("no/invalid coordinates means no geographic expansion", async () => {
  for (const d of [
    await destination(),
    { ...(await destination()), coordinates: { latitude: 999, longitude: 0 } },
  ]) {
    let calls = 0;
    await createWikimediaImages([d], async () => {
      calls++;
      return response({ batchcomplete: true });
    }).forDestination(d.id);
    assert.equal(calls, 1);
  }
});
test("Commons timeout and rate limits fall back without a geographic retry or leaking errors", async () => {
  const d = {
    ...(await destination()),
    coordinates: { latitude: 42, longitude: 20 },
  };
  const timed = await createWikimediaImages(
    [d],
    async () => new Promise(() => {}),
    5,
  ).forDestination(d.id);
  assert.deepEqual(timed.sourceStatus, {
    status: "fallback",
    reason: "timeout",
  });
  for (const payload of [
    response({ error: "private body" }, 429),
    response({ error: { code: "maxlag", info: "private body" } }),
    response({ error: { code: "ratelimited" } }),
  ]) {
    let calls = 0;
    const image = await createWikimediaImages([d], async () => {
      calls++;
      return payload;
    }).forDestination(d.id);
    assert.equal(calls, 1);
    assert.deepEqual(image.sourceStatus, {
      status: "fallback",
      reason: "rate-limit",
    });
    assert.equal(JSON.stringify(image).includes("private body"), false);
  }
});
test("verified local skips both external providers even when Pexels is configured", async () => {
  const d = await destination();
  d.image = { ...d.image!, source: "local", verification: "verified" };
  let calls = 0;
  const image = await createImageCandidateDiscovery(
    [d],
    "test-key",
    async () => {
      calls++;
      return response(body);
    },
  ).forDestination(d.id);
  assert.equal(calls, 0);
  assert.deepEqual(image, d.image);
});
test("Wikimedia wins before Pexels and Pexels is optional", async () => {
  const d = await destination();
  for (const key of [undefined, "test-key"]) {
    const calls: string[] = [];
    const image = await createImageCandidateDiscovery([d], key, async (url) => {
      calls.push(new URL(url).hostname);
      return response(body);
    }).forDestination(d.id);
    assert.deepEqual(calls, ["commons.wikimedia.org"]);
    assert.equal(image.sourceId, "wikimedia-commons:123");
  }
});
test("Pexels follows Commons failures only when configured; otherwise local illustration remains", async () => {
  const d = await destination();
  for (const key of [undefined, "test-key"]) {
    const calls: string[] = [];
    const image = await createImageCandidateDiscovery([d], key, async (url) => {
      calls.push(new URL(url).hostname);
      if (url.includes("commons.wikimedia"))
        return response({ error: "private" }, 429);
      return response({
        photos: [
          {
            id: 1,
            width: 2400,
            height: 1600,
            photographer: "Pexels Author",
            photographer_url: "https://www.pexels.com/@author",
            url: "https://www.pexels.com/photo/example-1/",
            src: { original: "https://images.pexels.com/photos/1/example.jpg" },
          },
        ],
      });
    }).forDestination(d.id);
    assert.deepEqual(
      calls,
      key
        ? ["commons.wikimedia.org", "api.pexels.com"]
        : ["commons.wikimedia.org"],
    );
    assert.equal(
      image.src,
      key ? "https://images.pexels.com/photos/1/example.jpg" : d.image!.src,
    );
  }
});
test("both providers failing still returns the existing local image", async () => {
  const d = await destination();
  const image = await createImageCandidateDiscovery(
    [d],
    "test-key",
    async () => {
      throw Error("private failure");
    },
  ).forDestination(d.id);
  assert.equal(image.src, d.image!.src);
  assert.equal(image.sourceStatus?.status, "fallback");
  assert.equal(JSON.stringify(image).includes("private failure"), false);
});
