import type { CalibrationDataset, CalibrationReport } from "./types";
import { calibrationMetrics } from "./metrics";
import { safeMediaUrl } from "../../../domain/media/validation";
const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function reviewHtml(
  report: CalibrationReport,
  dataset: CalibrationDataset,
) {
  const metrics = calibrationMetrics(report, dataset);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https://upload.wikimedia.org; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>GoEksplo destination media calibration</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:1150px;margin:auto;padding:24px;color:#25313b;background:#fafaf8}h1{font-size:28px}section{border-top:1px solid #ccd3d5;padding:24px 0}article{background:white;border:1px solid #ccd3d5;border-radius:8px;padding:16px;overflow-wrap:anywhere}nav,.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:16px}img{width:100%;height:210px;object-fit:contain;background:#edf0ed}pre{white-space:pre-wrap;font-size:13px}a{color:#943908}.pending{font-weight:600;color:#865900}</style></head><body><h1>Destination media calibration</h1><p>Research artifact. Automatic approval and ingestion OFF. No production approvals. Mode: ${escape(report.mode)}. Stop: ${escape(report.stopReason)}.</p><p class="pending">Human visual review pending unless explicitly labeled. Scores and metadata are not proof of a correct photograph.</p><p>Review labels live in the accompanying JSON. Only set visual labels after opening and inspecting the image; record method, timestamp and notes. Regenerate this report with --report-only. These labels never publish an image.</p><details><summary>Metrics and denominators</summary><pre>${escape(JSON.stringify(metrics, null, 2))}</pre></details>${report.rows
    .map(
      (row) =>
        `<section><h2>${escape(row.input.name)} · ${escape(row.input.countryCode)} · ${escape(row.input.placeKind)}</h2><p>${escape(row.input.subject)} · ${escape(row.status)} · ${escape(row.identity.resolutionMethod)} / ${escape(row.identity.confidence)}</p><p>Resolved: ${row.identity.external ? `<a href="https://www.wikidata.org/wiki/${escape(row.identity.external.id)}" rel="noreferrer">${escape(row.identity.external.id)}</a>` : "unresolved"}. Expected: ${escape(dataset.cases.find((c) => c.input.subject === row.input.subject)?.expected.wikidataId ?? "not asserted")}.</p><p>Requests: Wikidata ${row.requests.wikidata}, Commons ${row.requests.commons}. Failures: ${escape(row.failureCategories.join(", ") || "none")}.</p><p>${escape(dataset.cases.find((c) => c.input.subject === row.input.subject)?.notes)}</p><div class="grid">${
          row.candidates
            .map(({ candidate: c, review, sourceProperties }) => {
              const url = c.asset.originalUrl;
              const preview =
                url &&
                safeMediaUrl(
                  url,
                  "upload.wikimedia.org",
                  "/wikipedia/commons/",
                  true,
                ) &&
                /^\/wikipedia\/commons\/[a-f0-9]\/[a-f0-9]{2}\/[^/]+$/.test(
                  new URL(url).pathname,
                )
                  ? url.replace(
                      "/wikipedia/commons/",
                      "/wikipedia/commons/thumb/",
                    ) +
                    "/330px-" +
                    new URL(url).pathname.split("/").pop()
                  : null;
              return `<article>${preview ? `<img src="${escape(preview)}" alt="Unreviewed candidate ${escape(c.asset.id)}" loading="lazy" referrerpolicy="no-referrer">` : "<p>Safe thumbnail unavailable; inspect source manually.</p>"}<h3>${escape(c.asset.id)} · ${escape(c.sourceTier)} · ${c.evaluation.score}/100</h3><p>${escape(sourceProperties.join(", ") || "No direct property recorded")} · ${escape(c.decision)} · ${c.asset.width} × ${c.asset.height}</p><p>${c.asset.sourcePage ? `<a href="${escape(c.asset.sourcePage)}" rel="noreferrer">Commons source and licence</a>` : "No safe source link"}${url ? ` · <a href="${escape(url)}" rel="noreferrer">Original image</a>` : ""}</p><p>${escape(c.asset.author)} · ${escape(c.asset.license?.name ?? "Unusable/missing licence")}</p><p>${escape(c.asset.attribution)}</p><p>Depiction: ${escape(c.evidence.depictionTags.join(", ") || "sparse metadata")}. Article usage: ${c.evidence.articleUsage ? "observed" : "not measured"}.</p><pre>${escape(JSON.stringify(c.evaluation, null, 2))}</pre><p class="pending">${escape(review.method)} · relevant: ${escape(review.imageRelevant)} · role fit: ${escape(review.roleFit)}</p><p>${escape(review.reviewerNotes)}</p></article>`;
            })
            .join("") ||
          "<p>No candidates. No-image remains the safe product state.</p>"
        }</div></section>`,
    )
    .join("")}</body></html>`;
}
