import "server-only";
import { isInactiveDestinationId } from "../domain/destination-lifecycle";
import { cache } from "react";
import { approvedDestinationContent } from "../content/runtime/approved";
import { approvedPlaceMedia } from "../media/runtime/approved";
import { displayImageAsset } from "../media/runtime/display";
import { placeIdentities } from "../places/runtime/registry";
import { flightDestinations } from "../catalogue/flight-destinations";
import { destinationAccess } from "../travel/runtime/access";
import {
  destinationCollection,
  type DestinationCard,
} from "../domain/destination-discovery";
import { contentExcerpt } from "../content/presentation";
import type { DestinationContentStore } from "../domain/destination-content/types";
import type { PlaceMediaStore } from "../domain/media/types";
import type { TravelLocation } from "../domain/types";

/** Dependencies are explicit so retained historical records can be inspected without
 * adding them back to the production collection. */
export function createDestinationGuideService(
  destinationCollection: readonly { slug: string; subject: string }[],
  placeIdentities: typeof import("../places/runtime/registry").placeIdentities,
  destinationAccess: typeof import("../travel/runtime/access").destinationAccess,
  defaultContent: DestinationContentStore,
  defaultMedia: PlaceMediaStore,
) {
  /** Target identity only; operating airports are resolved by reviewed access. */
  function destinationGuideTarget(subject: string): TravelLocation | undefined {
    const identity = placeIdentities.find((place) => place.subject === subject);
    if (!identity || identity.confidence === "unresolved") return;
    const country =
      new Intl.DisplayNames(["en"], { type: "region" }).of(
        identity.countryCode,
      ) ?? identity.countryCode;
    const catalogue = flightDestinations.find((place) => place.id === subject);
    const access = destinationAccess.get(subject);
    const cityCode =
      access?.directCity?.providerCityCode ??
      catalogue?.cityCode ??
      (!access && identity.placeKind === "city"
        ? identity.cityCode
        : undefined);
    if (
      !cityCode &&
      !(
        access &&
        /^place:Q[1-9]\d{0,11}$/.test(subject) &&
        (access.directEntries?.length || access.gateways.length)
      )
    )
      return;
    return {
      id: cityCode ? `city:${cityCode}` : subject,
      type: "city",
      ...(cityCode ? { cityCode } : {}),
      name: identity.name,
      countryCode: identity.countryCode,
      countryName: { en: country, sq: country },
      coordinates: identity.coordinates,
    };
  }

  /** Reads reviewed snapshots only. No provider composition, network calls or quota use. */
  async function loadDestinationGuide(
    slug: string,
    contentStore: DestinationContentStore = defaultContent,
    mediaStore: PlaceMediaStore = defaultMedia,
  ) {
    const entry = destinationCollection.find((item) => item.slug === slug);
    if (!entry) return undefined;
    const identity = placeIdentities.find(
      (place) => place.subject === entry.subject,
    );
    const result = await contentStore.get(entry.subject);
    if (
      !identity ||
      result.status !== "reviewed" ||
      !result.content.overview?.text.en?.trim() ||
      (result.content.attractions?.length ?? 0) < 3 ||
      !result.content.sources.length
    )
      return undefined;
    const country =
      new Intl.DisplayNames(["en"], { type: "region" }).of(
        identity.countryCode,
      ) ?? identity.countryCode;
    const [cardPhoto, heroPhoto] = await Promise.all([
      mediaStore.get(entry.subject, "destination.card"),
      mediaStore.get(entry.subject, "destination.hero"),
    ]);
    const target = destinationGuideTarget(entry.subject);
    const card: DestinationCard = {
      ...entry,
      name: identity.name,
      country,
      countryCode: identity.countryCode,
      description: contentExcerpt(result.content.overview.text.en, 170),
      ...(cardPhoto.status === "approved"
        ? { image: displayImageAsset(cardPhoto.image) }
        : {}),
    };
    return {
      card,
      result,
      target,
      heroImage:
        heroPhoto.status === "approved"
          ? displayImageAsset(heroPhoto.image)
          : undefined,
    };
  }
  return { destinationGuideTarget, loadDestinationGuide };
}
const liveGuides = createDestinationGuideService(
  destinationCollection,
  placeIdentities.filter((p) => !isInactiveDestinationId(p.subject)),
  destinationAccess,
  approvedDestinationContent,
  approvedPlaceMedia,
);
export const { destinationGuideTarget, loadDestinationGuide } = liveGuides;
// React cache is request-scoped; it does not keep expired editorial sections alive.
export const getDestinationGuide = cache(loadDestinationGuide);
export async function getDestinationGuides() {
  const results = await Promise.all(
    destinationCollection.map((entry) => getDestinationGuide(entry.slug)),
  );
  return results.filter((guide): guide is NonNullable<typeof guide> => !!guide);
}
export type DestinationGuide = NonNullable<
  Awaited<ReturnType<typeof loadDestinationGuide>>
>;
