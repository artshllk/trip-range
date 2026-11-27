import { basename, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { subjectId, text } from "../../src/domain/places/validation";
import {
  editorialChecks,
  isEditorialReview,
  reviewerLabel,
  sha256,
  type CheckDecision,
  type EditorialCheck,
  type EditorialDecision,
} from "../../src/content/operator/editorial";
import {
  contentDigest,
  contentItems,
  editorialContent,
} from "../../src/content/integrity";
import { validateDestinationContentData } from "../../src/domain/destination-content/validation";
import { createPinnedDestinationContentStore } from "../../src/content/runtime/publication";
import {
  assessEditorialReview,
  newReview,
  rememberReview,
  reviewContext,
} from "./editorial-review";
import {
  loadEditorialWorkspace,
  writeEditorialFile,
  type EditorialWorkspace,
} from "./editorial-workspace";

export function editorialArguments(
  args: readonly string[],
  values: readonly string[],
  switches: readonly string[] = [],
) {
  if (
    args.length > 24 ||
    args.some((arg) => arg.length > 600 || /[\u0000-\u001f\u007f]/.test(arg))
  )
    throw Error("invalid-arguments");
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const [key, ...parts] = args[i].split("=");
    if (flags.has(key)) throw Error("duplicate-argument");
    if (switches.includes(key) && parts.length === 0) flags.set(key, "true");
    else if (values.includes(key)) {
      const value = parts.length ? parts.join("=") : args[++i];
      if (!value || value.startsWith("--")) throw Error("missing-argument");
      flags.set(key, value);
    } else throw Error("unknown-argument");
  }
  return flags;
}
function selected(flags: Map<string, string>, workspace: EditorialWorkspace) {
  const id = flags.get("--destination");
  if (!subjectId(id) || !workspace.inputs.has(id))
    throw Error("exact-known-destination-required");
  return workspace.inputs.get(id)!;
}

export function setDestinationReview(
  args: readonly string[],
  workspace = loadEditorialWorkspace(),
) {
  const flags = editorialArguments(
    args,
    [
      "--destination",
      "--reviewer",
      "--digest",
      "--check",
      "--status",
      "--decision",
      "--ack",
      "--reason",
    ],
    ["--reset"],
  );
  const input = selected(flags, workspace),
    id = input.record.destinationId;
  const reviewer = flags.get("--reviewer"),
    expected = flags.get("--digest");
  if (
    !reviewerLabel(reviewer) ||
    !sha256(expected) ||
    expected !== contentDigest(input.record)
  )
    throw Error("reviewer-and-current-digest-required");
  const modes = ["--check", "--decision", "--ack", "--reset"].filter((key) =>
    flags.has(key),
  );
  if (
    modes.length !== 1 ||
    flags.has("--status") !== flags.has("--check") ||
    flags.has("--reason") !== (flags.has("--ack") || flags.has("--reset"))
  )
    throw Error("one-explicit-review-action-required");
  const previous = workspace.reviews.get(id);
  const before = assessEditorialReview(input, previous);
  const structural = validateDestinationContentData(
    { schemaVersion: 1, records: [input.record] },
    reviewContext(input.identity),
  );
  if (!structural.ok) throw Error("invalid-content");
  if (input.record.reviewStatus === "reviewed")
    throw Error("withdraw-reviewed-content-before-changing-review");
  let review = previous ?? newReview(input, reviewer);
  let next = structuredClone(review.current);
  let reason: string;
  if (flags.has("--reset")) {
    if (
      !previous ||
      input.record.reviewStatus !== "draft" ||
      !text(flags.get("--reason"), 500)
    )
      throw Error("reset-needs-draft-history-and-reason");
    next = newReview(input, reviewer).current;
    reason = flags.get("--reason")!;
  } else {
    if (before.stale) throw Error("stale-review-reset-required");
    next.reviewer = reviewer;
    next.updatedAt = new Date(input.now).toISOString();
    next.reviewedAt = null;
    if (flags.has("--check")) {
      const check = flags.get("--check"),
        status = flags.get("--status");
      if (
        !editorialChecks.includes(check as EditorialCheck) ||
        !["pending", "approved", "changes-required"].includes(status ?? "")
      )
        throw Error("invalid-check");
      next.checks[check as EditorialCheck] = status as CheckDecision;
      next.decision = Object.values(next.checks).includes("changes-required")
        ? "changes-required"
        : "pending";
      reason = `Check ${check}: ${status}`;
    } else if (flags.has("--ack")) {
      const warning = flags.get("--ack")!,
        explanation = flags.get("--reason");
      if (
        !text(explanation, 500) ||
        !before.advisory.some((item) => item.id === warning)
      )
        throw Error("only-known-advisory-may-be-acknowledged");
      next.warningsAcknowledged = [
        ...next.warningsAcknowledged.filter((item) => item.id !== warning),
        { id: warning, reason: explanation },
      ];
      next.decision = "pending";
      reason = `Advisory ${warning}: ${explanation}`;
      if (reason.length > 500)
        reason = `Acknowledged ${warning}; explanation retained in snapshot`;
    } else {
      const decision = flags.get("--decision");
      if (
        !["pending", "approved", "changes-required", "withdrawn"].includes(
          decision ?? "",
        )
      )
        throw Error("invalid-decision");
      if (decision === "withdrawn" && input.record.reviewStatus !== "withdrawn")
        throw Error("withdraw-content-before-recording-withdrawn-decision");
      next.decision = decision as EditorialDecision;
      next.reviewedAt = decision === "approved" ? next.updatedAt : null;
      reason = `Decision: ${decision}`;
    }
  }
  review = previous
    ? rememberReview(previous, next, reason)
    : { ...review, current: next };
  if (!isEditorialReview(review, input.now))
    throw Error("invalid-review-all-checks-required-before-approval");
  const after = assessEditorialReview(input, review);
  if (next.decision === "approved" && !after.eligible)
    throw Error("approval-blocked-or-advisories-unacknowledged");
  writeEditorialFile(
    workspace,
    join(workspace.reviewDirectory, basename(workspace.contentFiles.get(id)!)),
    review,
  );
  return {
    destinationId: id,
    decision: next.decision,
    digest: next.contentDigest,
    publicationChanged: false,
    writes: 1,
    externalCalls: 0,
  };
}

export async function approveDestinationContent(
  args: readonly string[],
  workspace = loadEditorialWorkspace(),
) {
  const flags = editorialArguments(
    args,
    ["--destination", "--confirm-reviewed"],
    ["--apply"],
  );
  const input = selected(flags, workspace),
    id = input.record.destinationId;
  const apply = flags.has("--apply");
  if (
    (apply && flags.get("--confirm-reviewed") !== id) ||
    (!apply && flags.has("--confirm-reviewed"))
  )
    throw Error("apply-requires-exact-confirm-reviewed");
  const review = workspace.reviews.get(id),
    assessment = assessEditorialReview(input, review);
  if (
    !review ||
    !assessment.eligible ||
    input.record.reviewStatus !== "draft" ||
    input.record.reviewedAt !== null ||
    contentItems(input.record).some(
      ({ item }) => item.reviewStatus !== "draft" || item.reviewedAt !== null,
    )
  )
    throw Error("approval-prerequisites-not-met");
  const timestamp = new Date(input.now).toISOString();
  if (Date.parse(review.current.updatedAt) > input.now)
    throw Error("invalid-clock");
  const result = structuredClone(input.record);
  for (const item of [
    result,
    ...contentItems(result).map(({ item }) => item),
  ]) {
    item.reviewStatus = "reviewed";
    item.reviewedAt = timestamp;
  }
  result.publication = {
    contentDigest: assessment.contentDigest,
    identityDigest: assessment.identityDigest,
    approvedAt: timestamp,
  };
  if (
    !isDeepStrictEqual(editorialContent(result), editorialContent(input.record))
  )
    throw Error("approval-changed-factual-content");
  const data = { schemaVersion: 1 as const, records: [result] };
  const checked = validateDestinationContentData(
    data,
    reviewContext(input.identity),
  );
  if (!checked.ok) throw Error("post-approval-validation-failed");
  const runtime = await createPinnedDestinationContentStore(
    data,
    reviewContext(input.identity),
    () => input.now,
  ).get(id);
  if (
    runtime.status !== "reviewed" ||
    contentItems(runtime.content).length !== contentItems(result).length
  )
    throw Error("approval-would-publish-stale-or-partial-content");
  const path = workspace.contentFiles.get(id)!;
  const report = {
    destinationId: id,
    contentVersion: result.contentVersion,
    digest: assessment.contentDigest,
    reviewer: review.current.reviewer,
    reviewTimestamp: review.current.reviewedAt,
    approvalTimestamp: timestamp,
    warningsAcknowledged: review.current.warningsAcknowledged,
    files: [path.slice(workspace.root.length + 1)],
    itemsBecomingReviewed: [
      "destination",
      ...contentItems(result).map(({ id }) => id),
    ],
    dryRun: !apply,
    writes: apply ? 1 : 0,
    externalCalls: 0,
  };
  if (apply) writeEditorialFile(workspace, path, result);
  return report;
}
