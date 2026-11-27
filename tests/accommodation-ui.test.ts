import { test } from "node:test";
import assert from "node:assert/strict";
import { CHILD_INPUT, renderInChild } from "./child-render";
const accommodationBrowserStates = [
  "provider",
  "reviewed",
  "generic",
  "failure",
  "simple",
  "comfort",
  "family",
  "kyoto",
  "unavailable",
];
function renderAccommodationFixture(locale: "en" | "sq", state: string) {
  return renderInChild(
    `const {renderAccommodationFixture}=require('./.test-build/tests/render-accommodation-fixture.js');const [locale,state]=${CHILD_INPUT};process.stdout.write(renderAccommodationFixture(locale,state,''));`,
    [locale, state],
  );
}
for (const locale of ["en", "sq"] as const)
  test(`${locale}: scoped labels, no hotel CTA, no zero-cost missing stay`, () => {
    for (const state of accommodationBrowserStates) {
      const html = renderAccommodationFixture(locale, state);
      assert.doesNotMatch(
        html,
        /booking\.com|expedia\.com|DRAFT|Guaranteed hotel/,
      );
      assert.match(
        html,
        state === "unavailable"
          ? /stay-unpriced/
          : /data-completeness="complete"/,
      );
      assert.match(html, /data-stay-evidence=/);
      if (state === "provider") {
        assert.match(html, /provider-priced/);
        const staySource = html.match(
          /<li><b>(Stay|Qëndrimi)<\/b>[\s\S]*?<\/li>/,
        )?.[0];
        assert.ok(staySource);
        assert.doesNotMatch(
          staySource,
          /General or earlier|Shumë e përgjithshme/,
        );
        assert.match(
          staySource,
          locale === "en" ? /dates and guests/ : /datat dhe udhëtarët/,
        );
        assert.match(html, locale === "en" ? /non-refundable/ : /pakthyeshme/);
      }
      if (state === "family") {
        assert.match(html, /generic-estimate/);
        assert.match(
          html,
          locale === "en"
            ? /Child ages are not collected/
            : /Moshat e fëmijëve/,
        );
      }
      if (state === "reviewed") assert.match(html, /reviewed-estimate/);
    }
  });
