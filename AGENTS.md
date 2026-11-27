<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Branch lifecycle

Owner decision, 4 November 2026:

- Start each focused piece of work on a short-lived, descriptively named branch from current `main`.
- Target `main` in the PR by default. Use a stacked PR only when an explicit dependency requires it; do not let completed work stop on another task branch.
- Once the work is complete and its merge is authorized, run the required CI on the exact proposed revision, merge to `main` when green, verify the result there, and retire the merged branch.
- Keep unrelated changes out of the PR. Do not accumulate separate research, content, pricing or operational tasks under one old branch name.
- For dated content or scheduled audits, verify that `main` contains the new data and deadlines; a merge into an intermediate branch does not update the default-branch scheduler.
- This workflow does not grant standing permission for recurring commits, pushes or merges. Apply the user's authorization for the current task.
