import type { DestinationContent } from "../../src/domain/destination-content/types";
import type { PlaceIdentity } from "../../src/domain/places/types";
import { contentDigest, digest } from "../../src/content/integrity";

/** Synthetic fixtures only; never an operator approval shortcut. */
export function fixtureReceipt(
  record: DestinationContent,
  identity: PlaceIdentity,
) {
  record.publication = {
    contentDigest: contentDigest(record),
    identityDigest: digest(identity),
    approvedAt: record.reviewedAt!,
  };
}
