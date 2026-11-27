import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import ts from "typescript";

const read = (path: string) => readFileSync(path, "utf8");
const routePath = "src/app/[locale]/plan/trips/[id]/page.tsx";

function runtimeImports(path: string): string[] {
  const source = ts.createSourceFile(
    path,
    read(path),
    ts.ScriptTarget.Latest,
    true,
  );
  const paths: string[] = [];
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      statement.importClause?.isTypeOnly
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (
      bindings &&
      ts.isNamedImports(bindings) &&
      bindings.elements.length &&
      bindings.elements.every((item) => item.isTypeOnly)
    )
      continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const name = statement.moduleSpecifier.text;
    const base = name.startsWith("@/")
      ? resolve("src", name.slice(2))
      : name.startsWith(".")
        ? resolve(dirname(path), name)
        : undefined;
    if (!base) continue;
    const target = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(
      (candidate) =>
        existsSync(candidate) && /\.(?:tsx?|json)$/.test(candidate),
    );
    if (target) paths.push(relative(process.cwd(), target));
  }
  return paths;
}

test("trip detail combines reviewed content only at server rendering boundary and preserves noindex", () => {
  const route = read(routePath);
  assert.match(
    route,
    /approvedDestinationContent\.get\(\s*base\.destination\.id,?\s*\)/,
  );
  assert.match(route, /renderTripContentSections\(/);
  assert.match(route, /contentSections=/);
  assert.match(route, /robots:\s*\{\s*index:\s*false,\s*follow:\s*true\s*\}/);
  assert.doesNotMatch(
    route,
    /JSON\.stringify\((?:content|destinationContent|result)\)/,
  );
  assert.doesNotMatch(
    route,
    /(?:operator|adapters)\/(?:wikidata|osm)|research-destination|fetch\(/,
  );
  const clientImports = runtimeImports("src/components/travel/FullTrip.tsx");
  assert.ok(
    clientImports.every(
      (path) =>
        !/content\/(?:runtime|operator|adapters)|\/TripContent\.tsx$/.test(
          path,
        ),
    ),
    "Client imports rendered slots as types only, not raw content/store/research",
  );
});

test("editorial content never enters deterministic pricing, ranking or provider calculation import graphs", () => {
  const pending = [
    "src/domain/pricing.ts",
    "src/domain/ranking.ts",
    "src/domain/flight-pricing.ts",
    "src/domain/airport-comparison.ts",
    "src/domain/affiliate.ts",
    "src/services/travel.ts",
  ];
  const seen = new Set<string>();
  while (pending.length) {
    const path = pending.pop()!;
    if (seen.has(path)) continue;
    seen.add(path);
    assert.doesNotMatch(
      path,
      /(?:destination-content|src\/content\/|TripContent)/,
      `Financial graph must remain independent: ${path}`,
    );
    if (/\.tsx?$/.test(path)) pending.push(...runtimeImports(path));
  }
  assert.ok(
    seen.size > 10,
    "Regression checks real transitive domain dependencies",
  );
});

test("synthetic trip-detail browser fixture remains outside production imports and flags", () => {
  const files = [
    routePath,
    "src/components/travel/FullTrip.tsx",
    "src/components/travel/TripContent.tsx",
  ];
  for (const path of files) {
    assert.doesNotMatch(
      read(path),
      /tests\/fixtures|TRIP_DETAIL_FIXTURE|tripContentFixture|synthetic-content-city/,
    );
  }
  const content = read("src/components/travel/TripContent.tsx");
  assert.doesNotMatch(
    content,
    /["']use client["']|\bfetch\(|useEffect\(|api\.openai|api\.pexels|wikidata\.org\/w\/api/,
  );
});
