/** Offline source-graph guard. Type-only edges are erased and do not enter the client graph. */
import ts from "typescript";
import { posix } from "node:path";
export function checkImportBoundaries(files) {
  const graph = new Map(),
    clients = [],
    failures = [];
  const resolve = (from, name) => {
    const base = name.startsWith("@/")
      ? "src/" + name.slice(2)
      : name.startsWith(".")
        ? posix.normalize(posix.join(posix.dirname(from), name))
        : null;
    if (!base) return null;
    return (
      [
        base,
        ...(/\.[cm]?jsx?$/.test(base)
          ? [
              base.replace(/\.js$/, ".ts"),
              base.replace(/\.jsx?$/, ".tsx"),
              base.replace(/\.mjs$/, ".mts"),
              base.replace(/\.cjs$/, ".cts"),
            ]
          : []),
        base + ".ts",
        base + ".tsx",
        base + ".js",
        base + ".mjs",
        base + "/index.ts",
        base + "/index.tsx",
        base + "/index.js",
        base + "/index.mjs",
      ].find((p) => files.has(p)) ?? base
    );
  };
  for (const [path, text] of files) {
    if (!/\.[cm]?[jt]sx?$/.test(path)) continue;
    const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    if (
      ast.statements.some(
        (s) =>
          ts.isExpressionStatement(s) &&
          ts.isStringLiteral(s.expression) &&
          s.expression.text === "use client",
      )
    )
      clients.push(path);
    const edges = [];
    const visit = (node) => {
      let name;
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
        const bindings = node.importClause?.namedBindings;
        const onlyTypes =
          bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.length > 0 &&
          bindings.elements.every((e) => e.isTypeOnly) &&
          !node.importClause?.name;
        if (!onlyTypes && ts.isStringLiteral(node.moduleSpecifier))
          name = node.moduleSpecifier.text;
      } else if (
        ts.isImportEqualsDeclaration(node) &&
        !node.isTypeOnly &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression &&
        ts.isStringLiteral(node.moduleReference.expression)
      ) {
        name = node.moduleReference.expression.text;
      } else if (
        ts.isExportDeclaration(node) &&
        !node.isTypeOnly &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const onlyTypes =
          node.exportClause &&
          ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.length > 0 &&
          node.exportClause.elements.every((e) => e.isTypeOnly);
        if (!onlyTypes) name = node.moduleSpecifier.text;
      } else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require")) &&
        node.arguments.length >= 1 &&
        ts.isStringLiteralLike(node.arguments[0])
      )
        name = node.arguments[0].text;
      if (name) {
        const target = resolve(path, name);
        if (target) edges.push(target);
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
    graph.set(path, edges);
    if (
      path.startsWith("src/") ||
      path.startsWith("content/") ||
      path === "next.config.ts"
    ) {
      if (
        edges.some(
          (e) =>
            /(?:^|\/)(?:tests|fixtures|\.test-build)(?:\/|$)/.test(e) ||
            e.startsWith("scripts/"),
        )
      )
        failures.push({
          path,
          reason: "Production import of test/diagnostic code forbidden",
        });
    }
  }
  // Rendering and stored-content access have no path to research or live discovery.
  const runtimeRoot =
    /^(?:src\/(?:app|components|services|seo)\/|src\/(?:content|media|places|travel)\/runtime\/|src\/providers\/server\/(?:composition|images|editorial-images)\.ts$)/;
  const mediaOperator =
    /^(?:src\/(?:media|places)\/(?:operator|adapters)\/|src\/providers\/server\/(?:wikimedia|pexels|image-candidates)\.ts$|scripts\/(?:discover|calibrate)-destination-media|docs\/research\/destination-media\/)/;
  const contentOperator =
    /^(?:content\/(?:research|operations|archive|parked)\/|src\/content\/(?:operator|adapters)\/|scripts\/research-destination-content(?:\.|$)|docs\/research\/destination-content\/)/;
  for (const root of graph.keys()) {
    if (!runtimeRoot.test(root)) continue;
    const seen = new Set(),
      pending = [root];
    while (pending.length) {
      const path = pending.pop();
      if (seen.has(path)) continue;
      seen.add(path);
      if (mediaOperator.test(path) || contentOperator.test(path)) {
        failures.push({
          path: root,
          reason: contentOperator.test(path)
            ? "Runtime graph reaches operator-only destination content code"
            : "Runtime graph reaches operator-only media code",
        });
        break;
      }
      pending.push(...(graph.get(path) ?? []));
    }
  }
  for (const client of clients) {
    const seen = new Set(),
      pending = [client];
    while (pending.length) {
      const path = pending.pop();
      if (seen.has(path)) continue;
      seen.add(path);
      if (
        /^src\/(?:providers\/server\/|server\/|config\/(?:environment|readiness)\.ts$)/.test(
          path,
        ) ||
        /^content\/(?:places|research|operations|money)\//.test(path) ||
        /(?:^|\n)\s*import\s*["']server-only["']/.test(files.get(path) ?? "")
      ) {
        failures.push({
          path: client,
          reason: "Client graph reaches server-only configuration/code",
        });
        break;
      }
      pending.push(...(graph.get(path) ?? []));
    }
  }
  return failures;
}
