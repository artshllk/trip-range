import type { ImageAsset } from "../src/domain/types";

// Synthetic records only. No fixture is imported by application code or constitutes image approval.
export const trustedImageFixture: ImageAsset = {
  src: "/destinations/qa-trusted.png",
  source: "local",
  sourceId: "synthetic-reviewed-image",
  destinationId: "city:LON",
  verification: "verified",
  author: "Synthetic fixture photographer",
  attribution: "Synthetic approved asset for UI verification only",
  license: "Synthetic test licence",
  alt: "Synthetic image fixture, not a destination photograph",
};
export const pigeonImageFixture: ImageAsset = {
  ...trustedImageFixture,
  src: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Pigeon_in_London.jpg",
  source: "provider",
  sourceId: "wikimedia-commons:111",
  verification: "unverified",
  photoUrl: "https://commons.wikimedia.org/wiki/File:Pigeon_in_London.jpg",
  license: "https://creativecommons.org/licenses/by-sa/4.0/",
  alt: "Pigeon in London",
};
export const flowerImageFixture: ImageAsset = {
  ...pigeonImageFixture,
  destinationId: "crete",
  src: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Flower_from_Crete.jpg",
  photoUrl: "https://commons.wikimedia.org/wiki/File:Flower_from_Crete.jpg",
  sourceId: "wikimedia-commons:222",
  alt: "Flower from Crete",
};
