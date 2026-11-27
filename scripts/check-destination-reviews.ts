import { assessEditorialReview } from "./lib/editorial-review";
import {
  loadEditorialWorkspace,
  type EditorialWorkspace,
} from "./lib/editorial-workspace";
import { createPinnedDestinationContentStore } from "../src/content/runtime/publication";
import { reviewContext } from "./lib/editorial-review";

export async function checkDestinationReviews(workspace: EditorialWorkspace) {
  const failures: { destinationId: string; reasons: string[] }[] = [];
  for (const [id, input] of workspace.inputs) {
    const review = workspace.reviews.get(id),
      assessment = assessEditorialReview(input, review);
    const reasons = [
      ...assessment.blocking.filter((reason) =>
        /stale-|invalid-editorial|unknown-advisory/.test(reason),
      ),
    ];
    if (
      review?.current.decision === "approved" &&
      ((input.record.reviewStatus === "draft" && !assessment.eligible) ||
        assessment.unacknowledged.length)
    )
      reasons.push("approved-review-not-eligible");
    if (input.record.reviewStatus === "reviewed") {
      if (!review || review.current.decision !== "approved" || assessment.stale)
        reasons.push("publication-without-current-editorial-approval");
      const runtime = await createPinnedDestinationContentStore(
        { schemaVersion: 1, records: [input.record] },
        reviewContext(input.identity),
        () => input.now,
      ).get(id);
      // Expiry is a maintenance condition, not corruption of the historical approval.
      if (runtime.status === "none" && runtime.reason !== "no-current-content")
        reasons.push("publication-receipt-invalid");
    }
    if (reasons.length) failures.push({ destinationId: id, reasons });
  }
  return {
    status: failures.length ? "failed" : "passed",
    records: workspace.reviews.size,
    destinations: workspace.inputs.size,
    failures,
    writes: 0,
    externalCalls: 0,
  };
}
if (require.main === module) {
  (async () => {
    if (process.argv.length !== 2) throw Error("arguments");
    const result = await checkDestinationReviews(loadEditorialWorkspace());
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.failures.length ? 1 : 0;
  })().catch(() => {
    console.error(
      "Editorial review validation failed: invalid metadata, files or arguments.",
    );
    process.exitCode = 1;
  });
}
