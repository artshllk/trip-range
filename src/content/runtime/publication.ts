import "server-only";
import type {
  DestinationContentValidationContext,
  DestinationContentStore,
} from "../../domain/destination-content/types";
import { validateDestinationContentData } from "../../domain/destination-content/validation";
import { publicationReceiptMatches } from "../integrity";
import { createReviewedDestinationContentStore } from "./store";

/** Production boundary: receipts pin exact content and identity, with no operational imports. */
export function createPinnedDestinationContentStore(
  input: unknown,
  context: DestinationContentValidationContext,
  clock: () => number = Date.now,
): DestinationContentStore {
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(JSON.stringify(input));
  } catch {
    return createReviewedDestinationContentStore(null, context, clock);
  }
  const checked = validateDestinationContentData(snapshot, context);
  const store = createReviewedDestinationContentStore(snapshot, context, clock);
  const identities = new Map(
    context.identities.map((identity) => [identity.subject, identity]),
  );
  const blocked = new Set<string>();
  if (checked.ok)
    for (const record of checked.data.records) {
      if (record.reviewStatus !== "reviewed") continue;
      if (
        !publicationReceiptMatches(
          record,
          identities.get(record.identitySubject)!,
        )
      )
        blocked.add(record.destinationId);
    }
  return {
    async get(id) {
      return blocked.has(id)
        ? { status: "none", reason: "not-reviewed" }
        : store.get(id);
    },
  };
}
