import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { claimViolations } from "../src/domain/claims-policy";

// User-facing sources only. Operator tooling, logs and diagnostics are not shown to travellers.
const roots = [
  "src/i18n",
  "src/components",
  "src/app",
  "src/seo/content.ts",
  "src/seo/registry.ts",
  "src/seo/candidates/registry.ts",
  "src/services/legal.ts",
  "content/destinations",
];

function files(path: string): string[] {
  if (!statSync(path).isDirectory())
    return /\.(tsx?|json)$/.test(path) ? [path] : [];
  return readdirSync(path).flatMap((name) => files(join(path, name)));
}

/** Multi-word literals and JSX text: identifiers like "live" in `=== "live"` are code. */
function sourceTexts(path: string): string[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isJsxText(node)) out.push(node.text);
    else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node)
    ) {
      if (/\s/.test(node.text.trim())) out.push(node.text);
    } else if (ts.isTemplateExpression(node))
      out.push(
        node.head.text +
          node.templateSpans.map((s) => s.literal.text).join(" "),
      );
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

function jsonTexts(value: unknown): string[] {
  if (typeof value === "string") return /\s/.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(jsonTexts);
  if (value && typeof value === "object")
    return Object.values(value).flatMap(jsonTexts);
  return [];
}

test("user-facing text makes no live-price claims", () => {
  const violations: string[] = [];
  for (const file of roots.flatMap(files)) {
    const texts = file.endsWith(".json")
      ? jsonTexts(JSON.parse(readFileSync(file, "utf8")))
      : sourceTexts(file);
    for (const text of texts)
      for (const phrase of claimViolations(text))
        violations.push(
          `${file}: "${phrase}" in ${JSON.stringify(text.trim().slice(0, 140))}`,
        );
  }
  assert.deepEqual(violations, []);
});

test("claims policy exempts by context, not by word", () => {
  assert.deepEqual(claimViolations("Check live fares"), []);
  assert.deepEqual(claimViolations("Planning estimates, not live offers."), []);
  assert.deepEqual(claimViolations("They aren’t live quotes."), []);
  assert.deepEqual(claimViolations("It isn't a live price."), []);
  assert.deepEqual(
    claimViolations("Final prices are confirmed by the provider."),
    [],
  );
  assert.deepEqual(claimViolations("Fares are re-checked when you update."), [
    "re-checked",
  ]);
  assert.deepEqual(claimViolations("Live prices from airlines"), ["Live"]);
  assert.deepEqual(claimViolations("Current price unavailable"), [
    "Current price",
  ]);
});
