/** Prints paths/categories only. Never print matching lines or secret values. */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { parseEnv } from "node:util";
import { checkImportBoundaries } from "./check-import-boundaries.mjs";
export function checkSecurity({ bundles = false } = {}) {
  const tracked = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  )
    .split("\0")
    // Git still lists tracked files deleted in the working tree.
    .filter((path) => path && existsSync(path));
  const failures = [];
  const secretPattern =
    /\bsk-(?:proj-|svcacct-)?[a-zA-Z0-9_-]{40,}|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/;
  for (const path of tracked) {
    if (path.endsWith(".lock") || path === "package-lock.json") continue;
    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    if (secretPattern.test(text))
      failures.push({ path, reason: "Possible credential; content withheld" });
    if (path === ".env.local")
      failures.push({ path, reason: "Local environment must not be tracked" });
  }
  const template = readFileSync(".env.example", "utf8");
  if (Object.values(parseEnv(template)).some(Boolean))
    failures.push({
      path: ".env.example",
      reason: "Environment template must contain blank placeholders only",
    });
  for (const path of tracked.filter(
    (p) => p.startsWith("src/") || p === "next.config.ts",
  )) {
    const text = readFileSync(path, "utf8");
    if (
      /NEXT_PUBLIC_\w*(?:TOKEN|SECRET|API_KEY|MARKER|PROJECT_ID|MODEL)/.test(
        text,
      )
    )
      failures.push({
        path,
        reason: "Public provider configuration forbidden",
      });
  }
  const sourceFiles = new Map(
    tracked
      .filter(
        (p) =>
          (p.startsWith("src/") ||
            p.startsWith("content/") ||
            p === "next.config.ts") &&
          /\.[cm]?[jt]sx?$/.test(p),
      )
      .map((p) => [p, readFileSync(p, "utf8")]),
  );
  failures.push(...checkImportBoundaries(sourceFiles));
  if (bundles) {
    const environments = [process.env];
    for (const file of [".env", ".env.local"]) {
      try {
        environments.push(parseEnv(readFileSync(file, "utf8")));
      } catch {}
    }
    const secrets = [
      "OPENAI_API_KEY",
      "TRAVELPAYOUTS_API_TOKEN",
      "PEXELS_API_KEY",
      "RATE_LIMIT_REDIS_REST_TOKEN",
    ]
      .flatMap((k) => environments.map((env) => env[k]))
      .filter((v) => v && v.length >= 8);
    function walk(dir) {
      let entries;
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const name of entries) {
        const path = dir + "/" + name;
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(js|html|rsc|json|txt)$/.test(path)) {
          const text = readFileSync(path, "utf8");
          if (secretPattern.test(text) || secrets.some((s) => text.includes(s)))
            failures.push({
              path,
              reason: "Possible credential in public output; content withheld",
            });
        }
      }
    }
    walk(".next/static");
    // Server JS may reference private env names; scan emitted HTML/RSC, never private fetch caches.
    function rendered(dir) {
      let entries;
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const name of entries) {
        const path = dir + "/" + name;
        if (statSync(path).isDirectory()) rendered(path);
        else if (/\.(html|rsc)$/.test(path)) {
          const text = readFileSync(path, "utf8");
          if (secretPattern.test(text) || secrets.some((s) => text.includes(s)))
            failures.push({
              path,
              reason:
                "Possible credential in rendered output; content withheld",
            });
        }
      }
    }
    rendered(".next/server/app");
  }
  return failures;
}
if (process.argv[1]?.endsWith("check-security.mjs")) {
  const failures = checkSecurity({
    bundles: process.argv.includes("--bundles"),
  });
  console.log(
    JSON.stringify({
      check: "working-tree-secret-boundaries",
      status: failures.length ? "failed" : "passed",
      failures,
    }),
  );
  process.exitCode = failures.length ? 1 : 0;
}
