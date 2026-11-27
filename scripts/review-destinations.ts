import { editorialArguments } from "./lib/editorial-commands";
import { loadEditorialWorkspace } from "./lib/editorial-workspace";
import {
  editorialOverview,
  editorialMaintenance,
} from "./lib/editorial-maintenance";

export function reviewDestinations(args: readonly string[]) {
  const flags = editorialArguments(args, ["--status", "--limit", "--offset"]);
  const status = flags.get("--status"),
    limit = flags.get("--limit") ?? "50",
    offset = flags.get("--offset") ?? "0";
  if (
    (status &&
      ![
        "pending",
        "approved",
        "changes-required",
        "withdrawn",
        "stale",
        "due-soon",
      ].includes(status)) ||
    !/^\d+$/.test(limit) ||
    +limit < 1 ||
    +limit > 100 ||
    !/^\d+$/.test(offset) ||
    !Number.isSafeInteger(+offset)
  )
    throw Error("invalid-overview-arguments");
  const workspace = loadEditorialWorkspace();
  const due =
    status === "due-soon"
      ? new Set(
          editorialMaintenance(workspace).rows.map((row) => row.destinationId),
        )
      : undefined;
  const rows = editorialOverview(workspace).filter(
    (row) =>
      !status || (due ? due.has(row.destinationId) : row.decision === status),
  );
  console.log(
    "Destination | Identity | EN | Sources | Selection | Freshness | Decision | Digest",
  );
  for (const row of rows.slice(+offset, +offset + +limit))
    console.log(
      [
        row.destinationId,
        row.checks.identity,
        row.checks.englishCopy,
        row.checks.sources,
        row.checks.selectionAndOrder,
        row.checks.freshness,
        row.decision,
        row.stale
          ? "STALE"
          : workspace.reviews.has(row.destinationId)
            ? "current"
            : "unpinned",
      ].join(" | "),
    );
  console.log(
    `Shown ${Math.min(+limit, Math.max(0, rows.length - +offset))} of ${rows.length}; review records: ${workspace.reviews.size}; writes: 0; external calls: 0; automatic approval: OFF.`,
  );
  return 0;
}
if (require.main === module)
  try {
    process.exitCode = reviewDestinations(process.argv.slice(2));
  } catch {
    console.error(
      "Review overview unavailable: invalid arguments or source-controlled data.",
    );
    process.exitCode = 1;
  }
