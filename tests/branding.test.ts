import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { pageMetadata, siteUrl } from "../src/services/seo";
import { organizationSchema } from "../src/seo/publication";
import { validEditorialIntent } from "../src/seo/editorial";
import { seoLandingRegistry } from "../src/seo/registry";
import { brand } from "../src/config/brand";
const bytes = (p: string) => readFileSync(p);
const sha = (p: string) => createHash("sha256").update(bytes(p)).digest("hex");

test("deployed artwork matches the owner-approved bytes", () => {
  const approved: Record<string, string> = {
    "public/branding/trip-range/trip-range-horizontal-light.svg":
      "538e4cc71e7549bc7907d9338db5a1e8c58240e81d043d7e814780cffaaf8c7a",
    "public/branding/trip-range/trip-range-horizontal-dark.svg":
      "c7aa5a617afbf71de3b792fa2d28c656fc9b6aed805c9ef7bdf6ded40b1319d1",
    "public/branding/trip-range/trip-range-icon-light.svg":
      "c3f28d2e79f27c7b97541808eb43e0a94289d23f2ec0bb9e8ead1ef9d6eeb586",
    "public/branding/trip-range/trip-range-app-192.png":
      "78c3a3b556633e575c3f8cba1f1ba8d7c27ce3efd8d1c647c5265f53bcd45032",
    "public/branding/trip-range/trip-range-app-512.png":
      "bfa34952925f2a5aa435092144fcd5e4f02fdcfd2859adcb1877a21fc1bac604",
    "src/app/icon.svg":
      "a2788901979d7076d50402e1b9adc4f829ca948f013502b32b063ac647a9c8ba",
    "src/app/apple-icon.png":
      "ea1ccc61db2474972450c87b2dc19480d3d6ac3f90d0d748bbbb0134ced9430a",
  };
  for (const [path, expected] of Object.entries(approved))
    assert.equal(sha(path), expected, path);
  assert.equal(existsSync("src/app/icon.png"), false);
});

test("favicon ICO contains both approved native sizes without resampling", () => {
  const b = bytes("src/app/favicon.ico");
  assert.equal(b.readUInt16LE(2), 1);
  assert.equal(b.readUInt16LE(4), 2);
  for (const [index, size, hash] of [
    [0, 16, "f00f16b56acc4d80ec866deb737eae83736ae0b2969a1d22ce7c9024e545e287"],
    [1, 32, "8083def4fefb7bb36b5d18cd29760f28b0a825229523bba676f9463a5c59e18c"],
  ] as const) {
    const entry = 6 + 16 * index,
      length = b.readUInt32LE(entry + 8),
      offset = b.readUInt32LE(entry + 12);
    assert.equal(b[entry], size);
    assert.equal(b[entry + 1], size);
    assert.equal(
      createHash("sha256")
        .update(b.subarray(offset, offset + length))
        .digest("hex"),
      hash,
    );
  }
});

test("app manifest stays on the current origin without adding an installed-app mode", () => {
  const m = JSON.parse(readFileSync("src/app/manifest.webmanifest", "utf8"));
  assert.equal(m.name, brand.name);
  assert.equal(m.short_name, brand.name);
  assert.equal(m.start_url, "/");
  assert.equal(m.scope, "/");
  assert.equal(m.display, "browser");
  assert.deepEqual(
    m.icons.map((i: { sizes: string }) => i.sizes),
    ["192x192", "512x512"],
  );
  for (const i of m.icons) {
    assert.ok(i.src.startsWith("/branding/trip-range/"));
    assert.ok(existsSync("public" + i.src));
  }
  assert.ok(!JSON.stringify(m).includes("trip-range.com"));
});

test("brand metadata uses the Trip Range canonical origin and retains per-page index policy", () => {
  assert.equal(siteUrl, "https://www.trip-range.com");
  for (const index of [true, false]) {
    const m = pageMetadata(
      "en",
      "Budget trips",
      "Planning estimates",
      { en: "/" },
      index,
    );
    assert.equal(m.title, "Budget trips — Trip Range");
    assert.equal(m.alternates?.canonical, siteUrl);
    assert.deepEqual(m.robots, { index, follow: true });
    assert.equal(m.openGraph?.siteName, brand.name);
    assert.deepEqual(m.openGraph?.images, [
      {
        url: brand.socialImage,
        width: 1200,
        height: 630,
        alt: "Trip Range — travel within your budget",
      },
    ]);
    assert.equal(m.twitter?.title, "Budget trips");
    assert.ok(!JSON.stringify(m).includes("goeksplo.com"));
  }
  assert.equal(organizationSchema.name, brand.name);
  assert.equal(organizationSchema.url, siteUrl);
  assert.equal(organizationSchema.logo, siteUrl + brand.logo);
  const png = bytes("public" + brand.socialImage);
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});

test("editorial suffix adaptation preserves all existing quality checks", () => {
  for (const p of seoLandingRegistry) {
    assert.ok(validEditorialIntent(p));
    assert.ok(p.title.endsWith(" — Trip Range"));
    // Unreviewed drafts may still carry the legacy suffix.
    assert.ok(
      validEditorialIntent({
        ...p,
        title: p.title.replace(/ — Trip Range$/, " | GoEksplo"),
      }),
    );
    assert.equal(
      validEditorialIntent({
        ...p,
        title: p.title.replace(/Trip Range$/, "Other Brand"),
      }),
      false,
    );
    assert.equal(
      validEditorialIntent({ ...p, description: "x".repeat(181) }),
      false,
    );
    assert.equal(validEditorialIntent({ ...p, title: "x".repeat(71) }), false);
    assert.equal(
      validEditorialIntent({ ...p, h1: "Unrelated headline" }),
      false,
    );
  }
});
