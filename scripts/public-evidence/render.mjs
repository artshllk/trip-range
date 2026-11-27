import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Marked } from "marked";
const stage = process.argv[2];
const draft = "docs/content/resource-launch";
const read = (file) => readFileSync(file, "utf8");
const json = (file) => JSON.parse(read(file));
const pins = json(join(draft, "public-evidence-file-manifest.json"));
const delivery = json(join(stage, "delivery.json"));
const escape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const slug = (title) =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
const md = new Marked({
  gfm: true,
  renderer: {
    heading(token) {
      const text = this.parser.parseInline(token.tokens);
      return (
        "<h" +
        token.depth +
        ' id="' +
        escape(slug(token.text)) +
        '">' +
        text +
        "</h" +
        token.depth +
        ">\n"
      );
    },
  },
});
const files = (base) =>
  delivery.files.filter((row) => row.path.startsWith(base));
function fileList(rows, heading) {
  return (
    "<section><h3>" +
    escape(heading) +
    "</h3><ul>" +
    rows
      .map(
        (row) =>
          '<li><a href="' +
          escape(row.path) +
          '">' +
          escape(row.path.split("/files/")[1]) +
          "</a> — " +
          escape(row.purpose) +
          " " +
          escape(row.format.toUpperCase()) +
          ", " +
          row.bytes +
          " bytes. SHA-256 <code>" +
          row.sha256 +
          "</code></li>",
      )
      .join("") +
    "</ul></section>"
  );
}
const draftText = (file) => read(join(draft, file));
function document(path, title, body, output = path.slice(1)) {
  if (
    /github\.com\/artshllk\/goeksplo|Art Shllaku B\.I\.|Rruga Halit Asllani|href="\/en(?:\/|")/i.test(
      body,
    )
  )
    throw Error("Non-public reference in " + path);
  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="publisher" content="Trip Range"><title>' +
    escape(title) +
    ' — Trip Range</title><link rel="canonical" href="https://www.trip-range.com' +
    path +
    '">' +
    '<style>body{font:1rem/1.6 system-ui,sans-serif;color:#242620;margin:0}header,main,footer{max-width:55rem;margin:auto;padding:1rem 1.5rem}header,footer{border-block:1px solid #ddd}nav{display:flex;gap:1.2rem;flex-wrap:wrap}a{color:#214f52}h1,h2,h3{line-height:1.2}main{overflow-wrap:anywhere}pre{overflow:auto}table{display:block;overflow-x:auto;border-collapse:collapse}th,td{padding:.5rem;text-align:left;border-bottom:1px solid #ddd}code{font-size:.85em}</style></head><body><header><nav aria-label="Main"><a href="/">Trip Range</a><a href="/destinations">Destinations</a><a href="/methodology">Methodology</a><a href="/data">Data</a></nav></header><main id="main">' +
    body +
    '</main><footer><nav aria-label="Legal"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/affiliate-disclosure">Affiliate disclosure</a></nav></footer></body></html>';
  const file = join(stage, "pages", output + ".html");
  mkdirSync(file.substring(0, file.lastIndexOf("/")), { recursive: true });
  writeFileSync(file, html);
}
const fare = files(pins.fareReleaseBase),
  municipal = files(pins.municipalReleaseBase);
const farePath = pins.fareReleaseBase.replace(/\/files\/$/, "");
const catalogue = draftText("data-catalogue.md");
document("/data", "Travel cost data", md.parse(catalogue));
document(
  "/data",
  "Travel cost data",
  md.parse(
    catalogue.replace(
      /## Available studies[\s\S]*?(?=## Citation and corrections)/,
      "",
    ),
  ),
  "catalogue-before-acceptance",
);
const methods = read(join(stage, pins.fareReleaseBase, "methods.md")).replace(
  /^# .*\n/,
  "",
);
const study =
  md.parse(draftText("fare-coverage-2026-11-05.md")) +
  md.parse(methods) +
  ["coverage", "prices", "weighting"]
    .map((group) =>
      fileList(
        fare.filter((r) =>
          r.path.startsWith(pins.fareReleaseBase + group + "/"),
        ),
        group[0].toUpperCase() + group.slice(1) + " files",
      ),
    )
    .join("") +
  fileList(
    fare.filter(
      (r) => !r.path.slice(pins.fareReleaseBase.length).includes("/"),
    ),
    "Release files",
  );
document(
  farePath,
  "Two-night trips show 31% to 76% fewer destinations in cached flight data",
  study,
);
document(
  pins.municipalReleaseBase.replace(/\/files\/$/, ""),
  "Can a national price index predict a city’s hotel rate?",
  md.parse(draftText("municipal-hotel-scaling-2025.md")) +
    fileList(municipal, "Data and calculations"),
);
document(
  "/methodology",
  "How Trip Range measures fares",
  md.parse(draftText("methodology.md")),
);
