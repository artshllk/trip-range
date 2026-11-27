/** Manual, offline launch audit. Blob contents and matches never leave this function. No history mutation. */
import { execFileSync } from "node:child_process";
export function secretCategories(text) {
  const categories = [];
  if (/\bsk-(?:proj-|svcacct-)?[a-zA-Z0-9_-]{40,}/.test(text))
    categories.push("openai-credential");
  if (/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(text))
    categories.push("aws-access-key");
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))
    categories.push("private-key");
  // Config assignments only. References, blank placeholders and documentation examples do not qualify.
  for (const [name, category] of [
    ["TRAVELPAYOUTS_API_TOKEN", "travelpayouts-credential"],
    ["RATE_LIMIT_REDIS_REST_TOKEN", "redis-credential"],
    ["PEXELS_API_KEY", "pexels-credential"],
  ]) {
    const assignments = new RegExp(
      `^[ \\t]*${name}[ \\t]*=[ \\t]*["']?([^\\s"'#]+)`,
      "gm",
    );
    for (const match of text.matchAll(assignments)) {
      if (
        match[1].length >= 16 &&
        !/example|placeholder|replace|synthetic|your[_-]|process\.env|\$\{/i.test(
          match[1],
        )
      ) {
        categories.push(category);
        break;
      }
    }
  }
  return categories;
}
function sensitiveConfig(path) {
  return /(?:^|\/)\.env(?:[.-][^/]*)?$|\.env$|(?:^|\/)(?:config|configuration)\/|(?:^|\/)next\.config\.[cm]?[jt]s$|^\.github\/workflows\/[^/]+\.ya?ml$/.test(
    path,
  );
}
export function auditHistory(cwd = process.cwd()) {
  const findings = [];
  let complete = true;
  const git = (args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 15000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  try {
    if (git(["rev-parse", "--is-shallow-repository"]).trim() === "true")
      complete = false;
    const commits = git(["rev-list", "--all", "--reverse"])
      .trim()
      .split("\n")
      .filter(Boolean);
    if (commits.length > 10000) complete = false;
    const seen = new Set();
    for (const commit of commits.slice(0, 10000)) {
      if (!/^[a-f0-9]{40,64}$/.test(commit)) throw Error();
      for (const entry of git(["ls-tree", "-rz", "--long", commit])
        .split("\0")
        .filter(Boolean)) {
        const match = /^\d+ blob ([a-f0-9]+)\s+(\d+)\t([\s\S]+)$/.exec(entry);
        if (!match || !sensitiveConfig(match[3])) continue;
        const [, blob, size, path] = match;
        const identity = `${blob}:${path}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        if (Number(size) > 1024 * 1024 || seen.size > 20000) {
          complete = false;
          continue;
        }
        const categories = secretCategories(git(["cat-file", "blob", blob]));
        for (const category of categories)
          findings.push({
            commit: commit.slice(0, 12),
            path: /^[a-zA-Z0-9._/-]{1,240}$/.test(path)
              ? path
              : "[config-path-withheld]",
            category,
          });
      }
    }
  } catch {
    complete = false;
  }
  return {
    status: !complete
      ? "incomplete"
      : findings.length
        ? "findings"
        : "no-patterns-found",
    complete,
    findings,
    scope: "reachable-history-sensitive-config-files",
    manual: [
      "historical-openai-revocation-unconfirmed",
      "history-copies-and-access-review-required",
    ],
  };
}
if (process.argv[1]?.endsWith("check-history-secrets.mjs")) {
  if (process.argv.length !== 2) {
    console.log(
      JSON.stringify({ status: "incomplete", reason: "unsupported-arguments" }),
    );
    process.exitCode = 1;
  } else {
    const report = auditHistory();
    console.log(JSON.stringify(report, null, 2));
    if (!report.complete || report.findings.length) process.exitCode = 1;
  }
}
