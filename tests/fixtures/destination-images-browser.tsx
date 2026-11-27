/** Browser-only synthetic fixtures. Never imported into the app. */
import { createRoot } from "react-dom/client";
import { ResultCard } from "../../src/components/travel/ResultCard";
import { pricePlan } from "../../src/domain/pricing";
import { costTrip } from "../cost-profile-fixtures";
import {
  trustedImageFixture,
  pigeonImageFixture,
  flowerImageFixture,
} from "../destination-image-fixtures";
import type { ImageAsset } from "../../src/domain/types";
import approvedData from "./media/approved.synthetic.json";
import { createReviewedMediaStore } from "../../src/media/runtime/store";
import { displayImageAsset } from "../../src/media/runtime/display";
import en from "../../src/i18n/en.json";
import sq from "../../src/i18n/sq.json";
async function main() {
  const params = new URLSearchParams(location.search);
  const scenario = params.get("scenario") ?? "missing";
  const locale = params.get("locale") === "sq" ? "sq" : "en";
  const { base, request } = costTrip("EUR");
  const id = scenario === "flower" ? "crete" : "city:LON";
  const name = scenario === "flower" ? "Crete" : "London";
  let image: ImageAsset | undefined =
    scenario === "trusted"
      ? trustedImageFixture
      : scenario === "failed"
        ? { ...trustedImageFixture, src: "/destinations/qa-failed.png" }
        : scenario === "pigeon"
          ? pigeonImageFixture
          : scenario === "flower"
            ? flowerImageFixture
            : {
                ...trustedImageFixture,
                verification: "illustrative" as const,
                src: "/demo/van-portrait.png",
              };
  if (scenario.endsWith("-store")) {
    const data = structuredClone(approvedData);
    if (scenario === "no-store") data.selections = [];
    if (scenario === "corrupt-store")
      data.assets[0].originalUrl = "https://evil.test/unsafe.svg";
    if (scenario === "rejected-store")
      (data.rejections as unknown[]).push({
        subject: id,
        assetId: data.assets[0].id,
        reason: "Wrong scene",
        reviewedAt: "2026-10-10T12:00:00Z",
      });
    const selection = await createReviewedMediaStore(data).get(
      id,
      "destination.card",
    );
    image =
      selection.status === "approved"
        ? displayImageAsset(selection.image)
        : undefined;
  }
  const plan = pricePlan(
    {
      ...base,
      id,
      destination: {
        ...base.destination,
        id,
        name: { en: name, sq: name },
        country: {
          en: scenario === "flower" ? "Greece" : "United Kingdom",
          sq: scenario === "flower" ? "Greqia" : "Mbretëria e Bashkuar",
        },
        image,
        fallbackImage: {
          ...trustedImageFixture,
          verification: "illustrative",
          src: "/demo/van-portrait.png",
        },
      },
    },
    request,
  );
  createRoot(document.getElementById("root")!).render(
    <main className="results-page">
      <div className="shell results-shell">
        <h1 style={{ fontSize: 24, margin: "24px 0" }}>
          Synthetic image containment QA
        </h1>
        <ResultCard
          plan={plan}
          locale={locale}
          t={locale === "en" ? en : sq}
          index={0}
          currentYear="2026"
        />
      </div>
    </main>,
  );
}
void main();
