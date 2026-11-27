import { readdirSync, readFileSync } from "node:fs";
import { destinationContentData } from "../../content/destinations/records";
import { destinationContentValidationContext } from "../../src/content/runtime/approved";
import { createPinnedDestinationContentStore } from "../../src/content/runtime/publication";
import type { DestinationEditorialReview } from "../../src/content/operator/editorial";

/** Current-corpus integration checks run at its latest recorded editorial action,
 * not at CI's wall clock. Expiry behaviour is tested separately at each boundary.
 * This is test-only: production and the daily maintenance audit retain real time. */
export function currentEditorialNow(): number {
  const actions = readdirSync("content/operations/reviews")
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const review: DestinationEditorialReview = JSON.parse(
        readFileSync(`content/operations/reviews/${file}`, "utf8"),
      );
      return Date.parse(review.current.updatedAt);
    });
  const publications = destinationContentData.records.flatMap((record) =>
    record.publication ? [Date.parse(record.publication.approvedAt)] : [],
  );
  const now = Math.max(...actions, ...publications);
  if (!Number.isFinite(now)) throw Error("Missing recorded editorial clock");
  return now;
}

/** Exercise the real production store at each record's own publication instant. */
export const currentContentAtApproval = {
  get(id: string) {
    const record = destinationContentData.records.find(
      (r) => r.destinationId === id,
    );
    const at = record?.publication
      ? Date.parse(record.publication.approvedAt)
      : currentEditorialNow();
    return createPinnedDestinationContentStore(
      destinationContentData,
      destinationContentValidationContext,
      () => at,
    ).get(id);
  },
};
