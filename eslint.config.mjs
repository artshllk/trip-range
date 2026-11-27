import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/server/observability.ts"],
    rules: { "no-console": "error" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".evidence-build/**",
    ".evidence-checks/**",
    ".netlify/**", // Generated adapter bundles and their vendored dependencies.
    ".kilo/**",
    ".test-build/**",
    ".diagnostic-build/**",
    ".seo-build/**",
    ".media-build/**",
    ".content-build/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "docs/design-reference/**", // Supplied prototype runtimes, not application code.
  ]),
]);

export default eslintConfig;
