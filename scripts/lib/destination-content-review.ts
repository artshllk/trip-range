import { contentPresentationLimits as limits } from "../../src/content/presentation";
import type {
  ContentFreshness,
  ContentText,
  DestinationContent,
  DestinationContentValidationContext,
  SourcedContent,
} from "../../src/domain/destination-content/types";
import {
  safeContentSourceUrl,
  validateDestinationContentData,
} from "../../src/domain/destination-content/validation";
import type { PlaceIdentity } from "../../src/domain/media/types";
import { contentDigest } from "../../src/content/integrity";
import { pendingChecks } from "../../src/content/operator/editorial";
import type { EditorialAssessment } from "./editorial-review";

type ReviewField = { label: string; value: string | ContentText };
type ReviewItem = {
  id: string;
  fields: ReviewField[];
  provenance: SourcedContent;
};
type ReviewSection = { title: string; items: ReviewItem[] };
export type DestinationContentReview = {
  digest: string;
  editorial?: EditorialAssessment;
  record: DestinationContent;
  identity: PlaceIdentity;
  sections: ReviewSection[];
  counts: Record<string, number>;
  warnings: string[];
  questions: string[];
};

const textField = (
  label: string,
  value: string | ContentText,
): ReviewField => ({
  label,
  value,
});
const coordinates = (value: { latitude: number; longitude: number }) =>
  `${value.latitude}, ${value.longitude}`;

function reviewSections(record: DestinationContent): ReviewSection[] {
  return [
    {
      title: "Overview",
      items: record.overview
        ? [
            {
              id: "overview",
              fields: [textField("Overview", record.overview.text)],
              provenance: record.overview,
            },
          ]
        : [],
    },
    {
      title: "Highlights",
      items: (record.highlights ?? []).map((item) => ({
        id: item.id,
        fields: [textField("Highlight", item.text)],
        provenance: item,
      })),
    },
    {
      title: "Attractions",
      items: (record.attractions ?? []).map((item) => ({
        id: item.id,
        fields: [
          textField("Name", item.name),
          textField("Type", item.kind),
          textField("Description", item.shortDescription),
          ...(item.whyVisit
            ? [textField("Why include it", item.whyVisit)]
            : []),
          ...(item.bookingAdvice
            ? [textField("Booking advice", item.bookingAdvice)]
            : []),
          ...(item.typicalVisitMinutes
            ? [
                textField(
                  "Visit guidance (minutes)",
                  `${item.typicalVisitMinutes.minimum}–${item.typicalVisitMinutes.maximum}`,
                ),
              ]
            : []),
          ...(item.coordinates
            ? [textField("Coordinates", coordinates(item.coordinates))]
            : []),
          ...(item.externalIdentities ?? []).map((external) =>
            textField(
              "External identity",
              `${external.authority}: ${external.id}`,
            ),
          ),
          ...(item.media
            ? [
                textField(
                  "Reserved media reference (not approval)",
                  `${item.media.subject} / ${item.media.role}`,
                ),
              ]
            : []),
        ],
        provenance: item,
      })),
    },
    {
      title: "Areas",
      items: (record.areas ?? []).map((item) => ({
        id: item.id,
        fields: [
          textField("Name", item.name),
          textField("Summary", item.summary),
          ...item.goodFor.map((value) => textField("May suit", value)),
          ...item.tradeoffs.map((value) => textField("Tradeoff", value)),
          ...(item.coordinates
            ? [textField("Coordinates", coordinates(item.coordinates))]
            : []),
          ...(item.bounds
            ? [
                textField(
                  "Bounds",
                  `N ${item.bounds.north}; S ${item.bounds.south}; E ${item.bounds.east}; W ${item.bounds.west}`,
                ),
              ]
            : []),
        ],
        provenance: item,
      })),
    },
    {
      title: "Day templates",
      items: (record.dayTemplates ?? []).map((item) => ({
        id: item.id,
        fields: [
          textField("Title", item.title),
          textField("Suitable nights", item.suitableNights.join(", ")),
          ...item.stops.flatMap((stop, index) => {
            const attraction = record.attractions?.find(
              (entry) => entry.id === stop.attractionId,
            );
            return [
              textField(`Stop ${index + 1} ID`, stop.attractionId),
              ...(attraction
                ? [textField(`Stop ${index + 1} name`, attraction.name)]
                : []),
              ...(stop.notes
                ? [textField(`Stop ${index + 1} notes`, stop.notes)]
                : []),
            ];
          }),
          ...(item.notes ? [textField("Template notes", item.notes)] : []),
        ],
        provenance: item,
      })),
    },
    {
      title: "Transport",
      items: (record.transport ?? []).map((item) => ({
        id: item.id,
        fields: [
          textField("Title", item.title),
          textField("Guidance", item.guidance),
          ...(item.observedPrice
            ? [
                textField(
                  "Observed price (reference only; never a budget input)",
                  `${item.observedPrice.amount} ${item.observedPrice.currency}; observed ${item.observedPrice.observedAt}; source ${item.observedPrice.sourceId}`,
                ),
              ]
            : []),
        ],
        provenance: item,
      })),
    },
    {
      title: "Practical notes",
      items: (record.practicalNotes ?? []).map((item) => ({
        id: item.id,
        fields: [
          textField("Type", item.kind),
          textField("Note", item.text),
          ...(item.observedPrice
            ? [
                textField(
                  "Observed price (reference only; never a budget input)",
                  `${item.observedPrice.amount} ${item.observedPrice.currency}; observed ${item.observedPrice.observedAt}; source ${item.observedPrice.sourceId}`,
                ),
              ]
            : []),
        ],
        provenance: item,
      })),
    },
  ];
}

/** Pure offline report. Validation is required even for draft records. No promotion occurs. */
export function buildDestinationContentReview(
  data: unknown,
  context: DestinationContentValidationContext,
  destinationId: string,
  now: number = Date.now(),
): DestinationContentReview {
  if (!Number.isFinite(now)) throw Error("invalid-review-clock");
  const checked = validateDestinationContentData(data, context);
  if (!checked.ok) throw Error("invalid-destination-content");
  const record = checked.data.records.find(
    (entry) => entry.destinationId === destinationId,
  );
  if (!record) throw Error("destination-not-in-manifest");
  const identity = context.identities.find(
    (entry) => entry.subject === record.identitySubject,
  )!;
  const sections = reviewSections(record);
  const items = sections.flatMap((section) => section.items);
  const warnings: string[] = [];
  if (record.reviewStatus !== "reviewed")
    warnings.push("This record is not published by the runtime store.");
  if (record.reviewStatus === "draft")
    warnings.push(
      "Publication remains draft. English requires recorded human editorial review. Optional translations are not published in V1.",
    );
  if (identity.confidence === "unresolved")
    warnings.push(
      "Destination identity is unresolved; publication is blocked.",
    );
  for (const section of sections) {
    if (!section.items.length)
      warnings.push(
        `${section.title}: omitted. No content is fabricated to fill the section.`,
      );
  }
  for (const item of items) {
    const freshness = item.provenance.freshness;
    if (
      freshness.kind === "periodically-reviewed" &&
      Date.parse(freshness.reviewBy) <= now
    )
      warnings.push(
        `${item.id}: periodic review is due; the runtime excludes overdue content.`,
      );
    if (
      freshness.kind === "volatile" &&
      Date.parse(freshness.validUntil) <= now
    )
      warnings.push(
        `${item.id}: volatile fact is expired; the runtime excludes it.`,
      );
    if (freshness.kind === "volatile" && Date.parse(freshness.observedAt) > now)
      warnings.push(
        `${item.id}: observation is in the future; it cannot be current content.`,
      );
    if (item.provenance.reviewStatus !== record.reviewStatus)
      warnings.push(
        `${item.id}: section review status differs from the destination record.`,
      );
  }
  const warnLength = (
    label: string,
    value: ContentText | undefined,
    limit: number,
  ) => {
    // Retain historical SQ warning IDs so old approval acknowledgements stay valid.
    // Inactive-language warnings are informational, never required for English publication.
    for (const locale of ["en", "sq"])
      if (value?.[locale] && value[locale].length > limit)
        warnings.push(
          `${label} (${locale}) too long for the default presentation: ${value[locale].length}/${limit} characters. Full copy is retained behind a disclosure; consider concise editing.`,
        );
  };
  warnLength("Overview", record.overview?.text, limits.overviewCharacters);
  for (const item of record.attractions ?? [])
    warnLength(
      `Attraction description ${item.id}`,
      item.shortDescription,
      limits.attractionCharacters,
    );
  for (const item of record.areas ?? [])
    warnLength(`Area summary ${item.id}`, item.summary, limits.areaCharacters);
  for (const item of record.transport ?? [])
    warnLength(
      `Transport guidance ${item.id}`,
      item.guidance,
      limits.guidanceCharacters,
    );
  for (const item of record.practicalNotes ?? [])
    warnLength(
      `Practical note ${item.id}`,
      item.text,
      limits.guidanceCharacters,
    );
  for (const [label, count, limit] of [
    ["Attractions", record.attractions?.length ?? 0, limits.attractions],
    ["Transport points", record.transport?.length ?? 0, limits.transport],
    [
      "Practical notes",
      record.practicalNotes?.length ?? 0,
      limits.practicalNotes,
    ],
  ] as const)
    if (count > limit)
      warnings.push(
        `${label}: ${count} items; only the first ${limit} are initially visible. Confirm the stored editorial order.`,
      );
  for (const source of record.sources) {
    if (
      [source.observedAt, source.retrievedAt].some(
        (date) => date && Date.parse(date) > now,
      )
    )
      warnings.push(`${source.id}: source date is in the future.`);
  }
  return {
    digest: contentDigest(record),
    record,
    identity,
    sections,
    counts: {
      sources: record.sources.length,
      highlights: record.highlights?.length ?? 0,
      attractions: record.attractions?.length ?? 0,
      areas: record.areas?.length ?? 0,
      transportGuides: record.transport?.length ?? 0,
      practicalNotes: record.practicalNotes?.length ?? 0,
      dayTemplates: record.dayTemplates?.length ?? 0,
      stableItems: items.filter(
        (item) => item.provenance.freshness.kind === "stable",
      ).length,
      periodicItems: items.filter(
        (item) => item.provenance.freshness.kind === "periodically-reviewed",
      ).length,
      volatileItems: items.filter(
        (item) => item.provenance.freshness.kind === "volatile",
      ).length,
    },
    warnings,
    questions: [
      "Has a human checked each claim against its cited sources, including destination relationships?",
      "Has a human approved the English wording, including proper names and practical advice?",
      "Are the attraction selection, area tradeoffs and reusable templates appropriate for the stated destination and nights?",
      "Does the source-controlled editorial order put the most useful attractions, guidance and practical notes first?",
      "Have destination-specific uncertainties in docs/research/destination-content/ been resolved or accepted explicitly?",
      "Is there an owner and a review date for changing guidance before any publication?",
      ...(identity.placeKind === "island" || identity.placeKind === "region"
        ? [
            "Are attraction distribution and area choices honest about the size of the island/region, without implying unverified journey times or airport equivalence?",
          ]
        : []),
    ],
  };
}

export function contentFreshnessLabel(value: ContentFreshness): string {
  if (value.kind === "stable") return "Stable";
  if (value.kind === "periodically-reviewed")
    return `Periodically reviewed; review by ${value.reviewBy}`;
  return `Volatile; observed ${value.observedAt}; valid until ${value.validUntil}`;
}

function identityFields(identity: PlaceIdentity): ReviewField[] {
  return [
    textField("Stable destination ID", identity.subject),
    textField("Name", identity.name),
    textField("Country", identity.countryCode),
    textField("Place kind", identity.placeKind),
    textField("Confidence", identity.confidence),
    textField("Resolution method", identity.resolutionMethod),
    textField("Resolved at", identity.resolvedAt ?? "Not resolved"),
    textField("Identity policy", identity.policyVersion),
    textField(
      "External identity",
      identity.external
        ? `${identity.external.authority}: ${identity.external.id}`
        : "Absent",
    ),
    ...(identity.coordinates
      ? [textField("Coordinates", coordinates(identity.coordinates))]
      : []),
    textField("IATA codes", identity.iataCodes?.join(", ") || "Absent"),
    textField("City code", identity.cityCode ?? "Absent"),
    ...(identity.unresolvedReason
      ? [textField("Unresolved reason", identity.unresolvedReason)]
      : []),
  ];
}
const banner = (report: DestinationContentReview) =>
  report.record.reviewStatus === "draft"
    ? "DRAFT — NOT PUBLISHED"
    : "OFFLINE REVIEW — publication state unchanged";
const fieldText = (field: ReviewField) =>
  typeof field.value === "string"
    ? `${field.label}: ${field.value}`
    : `${field.label}\n  EN: ${field.value.en}`;

export function renderDestinationContentReviewText(
  report: DestinationContentReview,
): string {
  const { record } = report;
  return [
    banner(report),
    `${report.identity.name} (${record.destinationId})`,
    ...editorialSummary(report),
    `Record status: ${record.reviewStatus}; reviewed at: ${record.reviewedAt ?? "not reviewed"}; version: ${record.contentVersion}`,
    "Offline and read-only. No publication, network requests, AI calls or media approval.",
    "\nIDENTITY",
    ...identityFields(report.identity).map(fieldText),
    "\nCOUNTS (freshness counts describe content items, not atomic claims)",
    ...Object.entries(report.counts).map(([key, count]) => `${key}: ${count}`),
    ...report.sections.flatMap((section) => [
      `\n${section.title.toUpperCase()}`,
      ...(section.items.length
        ? section.items.flatMap((item) => [
            `\n${item.id}`,
            ...item.fields.map(fieldText),
            `Review: ${item.provenance.reviewStatus}; reviewed at: ${item.provenance.reviewedAt ?? "not reviewed"}`,
            `Freshness: ${contentFreshnessLabel(item.provenance.freshness)}`,
            `Sources: ${item.provenance.sourceIds.join(", ")}`,
          ])
        : ["Omitted"]),
    ]),
    "\nSOURCES",
    `Record source references: ${record.sourceIds.join(", ")}`,
    ...record.sources.flatMap((source) => [
      `${source.id}: ${source.title}`,
      `Publisher: ${source.publisher}; type: ${source.type}`,
      ...(source.url ? [`URL: ${source.url}`] : []),
      ...(source.externalId
        ? [
            `External identity: ${source.externalId.authority}: ${source.externalId.id}`,
          ]
        : []),
      `Observed: ${source.observedAt ?? "not recorded"}; retrieved: ${source.retrievedAt ?? "not recorded"}`,
      ...(source.licensing
        ? [
            `License: ${source.licensing.identifier}; ${source.licensing.url}; ${source.licensing.attribution}`,
          ]
        : []),
    ]),
    "\nWARNINGS",
    ...(report.warnings.length
      ? report.warnings
      : ["No structural warnings. This is not factual or editorial approval."]),
    "\nUNRESOLVED HUMAN REVIEW QUESTIONS",
    ...report.questions.map((question) => `- ${question}`),
  ].join("\n");
}

function editorialSummary(report: DestinationContentReview): string[] {
  const state = report.editorial;
  return [
    `Content version: ${report.record.contentVersion}`,
    `Current digest: ${report.digest}`,
    ...Object.entries(state?.checks ?? pendingChecks()).map(
      ([check, status]) => `${check}: ${status}`,
    ),
    `Overall review: ${state?.decision ?? "pending"}`,
    `Publication: ${report.record.reviewStatus === "withdrawn" ? "withdrawn — hidden" : report.record.reviewStatus === "reviewed" && state?.publicationPinned && !state.stale ? "reviewed — runtime freshness filtering still applies" : state?.eligible ? "eligible (explicit apply still required for a draft)" : "not approved"}`,
    ...(state?.blocking ?? []).map((message) => `BLOCKING: ${message}`),
    ...(state?.advisory ?? []).map(
      (warning) =>
        `ADVISORY ${warning.id}: ${warning.message}${state?.unacknowledged.some((item) => item.id === warning.id) ? " [unacknowledged]" : " [acknowledged]"}`,
    ),
  ];
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
const sourceAnchor = (id: string) => `source-${id}`;
function fieldHtml(field: ReviewField): string {
  return `<div class="field"><dt>${escapeHtml(field.label)}</dt><dd>${typeof field.value === "string" ? escapeHtml(field.value) : `<div class="languages"><div lang="en"><small>EN</small><p>${escapeHtml(field.value.en)}</p></div></div>`}</dd></div>`;
}
function safeLink(url: string, label: string): string {
  return safeContentSourceUrl(url)
    ? `<a href="${escapeHtml(url)}" rel="noreferrer noopener">${escapeHtml(label)}</a>`
    : "Unsafe source URL omitted";
}
/** Standalone local artifact only: no scripts, remote assets, fonts or application routes. */
export function renderDestinationContentReviewHtml(
  report: DestinationContentReview,
): string {
  const { record } = report;
  const list = (values: string[]) =>
    `<ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(report.identity.name)} · Draft content review</title><style>
  *{box-sizing:border-box}body{margin:0;background:#fff;color:#243344;font:16px/1.55 system-ui,sans-serif}main{max-width:1120px;margin:auto;padding:32px 20px}h1{font-size:2rem;line-height:1.15}h2{margin-top:2.5rem}h3{font-size:1rem;overflow-wrap:anywhere}.banner{background:#fff3db;border:1px solid #b86a16;padding:12px;font-weight:700}.note,small{color:#586777}section,article{min-width:0}article{border:1px solid #dde2e6;border-radius:12px;padding:20px;margin:16px 0}dt{font-weight:600}dd{margin:0}.field{margin-bottom:14px}.languages{display:grid;grid-template-columns:1fr;gap:24px}.languages p{margin:4px 0}summary{cursor:pointer;min-height:40px;padding:8px 0}a,dd,p,li{overflow-wrap:anywhere}a{color:#934b17}.metadata{font-size:.875rem}.counts{display:flex;flex-wrap:wrap;gap:8px}.counts span{background:#f1f4f6;padding:5px 9px;border-radius:5px}@media(max-width:640px){main{padding:20px 14px}.languages{grid-template-columns:1fr;gap:10px}article{padding:14px}h1{font-size:1.6rem}}@media print{a{color:inherit}article{break-inside:avoid}}
  </style></head><body><main><p class="banner">${escapeHtml(banner(report))}</p><h1>${escapeHtml(report.identity.name)} — destination content review</h1><p class="note">Offline, read-only review artifact. No publication, network requests, AI calls or media approval. English requires explicit human review. V1 publishes English only.</p><p>Status: ${escapeHtml(record.reviewStatus)} · Version ${record.contentVersion} · Reviewed: ${escapeHtml(record.reviewedAt ?? "not reviewed")}</p><section aria-label="Editorial decision"><h2>Editorial review</h2>${list(editorialSummary(report).filter((line) => !/^(ADVISORY|BLOCKING)/.test(line)))}${report.editorial ? `<details><summary>Review blockers and advisories (${report.editorial.blocking.length} blocking, ${report.editorial.advisory.length} advisory)</summary>${list(editorialSummary(report).filter((line) => /^(ADVISORY|BLOCKING)/.test(line)))}</details>` : ""}</section><section><h2>Destination identity</h2><details><summary>Identity verification details</summary><dl>${identityFields(report.identity).map(fieldHtml).join("")}</dl></details></section><section><details><summary>Counts and freshness coverage</summary><p class="counts">${Object.entries(
    report.counts,
  )
    .map(([label, value]) => `<span>${escapeHtml(label)}: ${value}</span>`)
    .join(
      "",
    )}</p><p class="note">Freshness counts describe content items, not atomic factual claims. Research request counts and candidate selection are recorded separately in the evidence report.</p></details></section>
  ${report.sections.map((section) => `<section><h2>${escapeHtml(section.title)}</h2>${section.items.length ? section.items.map((item) => `<article><h3>${escapeHtml(typeof item.fields[0]?.value === "object" ? item.fields[0].value.en : section.title)}</h3><dl>${item.fields.map(fieldHtml).join("")}</dl><details><summary>Sources, freshness &amp; review</summary><p class="metadata">ID: ${escapeHtml(item.id)}<br>Review: ${escapeHtml(item.provenance.reviewStatus)} · Reviewed: ${escapeHtml(item.provenance.reviewedAt ?? "not reviewed")}<br>Freshness: ${escapeHtml(contentFreshnessLabel(item.provenance.freshness))}<br>Sources: ${item.provenance.sourceIds.map((id) => `<a href="#${escapeHtml(sourceAnchor(id))}">${escapeHtml(id)}</a>`).join(", ")}</p></details></article>`).join("") : "<p>Omitted. No content is fabricated to fill this section.</p>"}</section>`).join("")}
  <section><h2>Sources</h2><p>Record source references: ${record.sourceIds.map((id) => `<a href="#${escapeHtml(sourceAnchor(id))}">${escapeHtml(id)}</a>`).join(", ")}</p>${record.sources.map((source) => `<article id="${escapeHtml(sourceAnchor(source.id))}"><h3>${escapeHtml(source.title)}</h3><details><summary>Source metadata</summary><p>${source.url ? safeLink(source.url, source.title) : escapeHtml(source.title)}</p><p>Publisher: ${escapeHtml(source.publisher)} · Type: ${escapeHtml(source.type)}</p>${source.externalId ? `<p>External identity: ${escapeHtml(source.externalId.authority)}: ${escapeHtml(source.externalId.id)}</p>` : ""}<p class="metadata">Observed: ${escapeHtml(source.observedAt ?? "not recorded")} · Retrieved: ${escapeHtml(source.retrievedAt ?? "not recorded")}</p>${source.licensing ? `<p>License: ${safeLink(source.licensing.url, source.licensing.identifier)} · ${escapeHtml(source.licensing.attribution)}</p>` : ""}</details></article>`).join("")}</section><section><h2>Warnings</h2>${list(report.warnings.length ? report.warnings : ["No structural warnings. This is not factual or editorial approval."])}</section><section><h2>Unresolved human review questions</h2>${list(report.questions)}</section></main></body></html>`;
}
