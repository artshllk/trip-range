// Netlify: exit 0 skips; exit 1 builds. Runs before dependency installation (Node 18).
import { spawnSync } from "node:child_process";

function decision() {
  const { CACHED_COMMIT_REF: cached, COMMIT_REF: current } = process.env;
  const sha = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
  if (!cached || !current || !sha.test(cached) || !sha.test(current))
    return "build: missing or invalid commit reference";
  // Netlify sets these equal when no cache is available. Never skip that build.
  if (cached === current)
    return "build: identical references / no proven cache";
  const git = (args) =>
    spawnSync("git", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  for (const ref of [cached, current]) {
    const result = git(["rev-parse", "--verify", `${ref}^{commit}`]);
    if (result.error || result.status !== 0)
      return "build: unusable commit reference";
  }
  // Disable rename detection so moving application code into docs still builds.
  const result = git([
    "diff",
    "--no-ext-diff",
    "--no-renames",
    "--name-only",
    "-z",
    cached,
    current,
    "--",
  ]);
  if (result.error || result.status !== 0 || typeof result.stdout !== "string")
    return "build: comparison failed";
  const paths = result.stdout.split("\0").filter(Boolean);
  return paths.every(
    (p) => p.startsWith("docs/") || /\.(?:md|markdown)$/i.test(p),
  )
    ? "skip: only documentation/Markdown changed"
    : "build: non-documentation change";
}
try {
  const result = decision();
  console.log(result);
  process.exitCode = result.startsWith("skip:") ? 0 : 1;
} catch {
  console.log("build: unexpected comparison error");
  process.exitCode = 1;
}
