// Checks that every city tax and airport transfer record's verbatim quotes appear in
// their official sources (docs/city-costs.md). Network; run by hand and at each review.
//   node scripts/check-city-cost-sources.mjs [--only CODE,CODE]
// Exit 1 if any quote cannot be found. A source with a dated `manualCheck` (it
// refuses automated reads; the quote was verified by hand) is reported as
// UNVERIFIABLE, never as ok, and fails once that manual check is over 60 days old.
//
// Sources are compared as text with whitespace and case folded:
// - HTML: tags removed, entities decoded, decoded with the page's declared charset.
// - JSON (open-data APIs): compact JSON.
// - XML, also inside a single-file .zip (the DGFiP tariff catalogue): the raw XML.
// - PDF: text extracted with macOS PDFKit (osascript). Elsewhere a PDF is reported
//   as MANUAL and must be checked by hand.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

const files = [
  ["city tax", "content/city-costs/city-tax.json", (r) => r.city],
  ["transfer", "content/city-costs/airport-transfers.json", (r) => r.airport],
];
const only = process.argv.includes("--only")
  ? new Set(process.argv[process.argv.indexOf("--only") + 1].split(","))
  : undefined;

const fold = (s) =>
  s
    .normalize("NFKC")
    .replace(/[   ]/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

// Named entities seen on official sources: common punctuation, Latin accents and the
// Greek letters (oasa.gr writes Greek as &Alpha;...). Unknown entities are left as is.
const greek =
  "Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho _ Sigma Tau Upsilon Phi Chi Psi Omega".split(
    " ",
  );
const entities = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  euro: "€",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  ndash: "–",
  mdash: "—",
  sigmaf: "ς",
  shy: "",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  deg: "°",
};
greek.forEach((name, i) => {
  if (name === "_") return;
  entities[name] = String.fromCodePoint(0x391 + i);
  entities[name.toLowerCase()] = String.fromCodePoint(0x3b1 + i);
});
const combining = {
  grave: "̀",
  acute: "́",
  circ: "̂",
  tilde: "̃",
  uml: "̈",
  ring: "̊",
  cedil: "̧",
};
for (const [letter, marks] of Object.entries({
  a: "grave acute circ tilde uml ring",
  e: "grave acute circ uml",
  i: "grave acute circ uml",
  o: "grave acute circ tilde uml",
  u: "grave acute circ uml",
  c: "cedil",
  n: "tilde",
}))
  for (const mark of marks.split(" ")) {
    entities[letter + mark] = (letter + combining[mark]).normalize("NFC");
    entities[letter.toUpperCase() + mark] = (
      letter.toUpperCase() + combining[mark]
    ).normalize("NFC");
  }

function text(html) {
  return html
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&([a-zA-Z]+);/g, (m, name) => entities[name] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16)),
    );
}

function decode(bytes, type) {
  const head = bytes.subarray(0, 4096).toString("latin1");
  const charset =
    /charset=["']?([\w-]+)/i.exec(type)?.[1] ??
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ??
    "utf-8";
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** The single entry of a .zip (central directory read; stored or deflated). */
function unzipSingle(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("not a zip file");
  const cd = buf.readUInt32LE(eocd + 16);
  const method = buf.readUInt16LE(cd + 10);
  const size = buf.readUInt32LE(cd + 20);
  const local = buf.readUInt32LE(cd + 42);
  const start =
    local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
  const data = buf.subarray(start, start + size);
  if (method === 0) return data;
  if (method === 8) return inflateRawSync(data);
  throw new Error(`unsupported zip method ${method}`);
}

const pdfScript = `ObjC.import('PDFKit');
function run(argv) {
  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]));
  if (!doc || doc.isNil()) throw new Error('cannot open PDF');
  const s = doc.string;
  return s && !s.isNil() ? s.js : '';
}`;
function pdfText(bytes) {
  if (process.platform !== "darwin") return undefined;
  const dir = mkdtempSync(join(tmpdir(), "city-cost-pdf-"));
  try {
    const file = join(dir, "source.pdf");
    writeFileSync(file, bytes);
    return execFileSync(
      "osascript",
      ["-l", "JavaScript", "-e", pdfScript, file],
      { maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] },
    ).toString();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const cache = new Map();
function load(url) {
  if (!cache.has(url))
    cache.set(
      url,
      (async () => {
        const res = await fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 (source-check)",
            Accept: "text/html,application/xhtml+xml,application/pdf,*/*",
          },
          signal: AbortSignal.timeout(60000),
          redirect: "follow",
        });
        if (!res.ok) return { status: res.status };
        const type = res.headers.get("content-type") ?? "";
        let bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])))
          bytes = unzipSingle(bytes);
        if (bytes.subarray(0, 5).toString() === "%PDF-") {
          const t = pdfText(bytes);
          return t === undefined
            ? { status: 200, manual: "PDF" }
            : { status: 200, text: fold(t) };
        }
        const body = decode(bytes, type);
        if (/json/i.test(type))
          // Open-data APIs: the quote is the compact JSON the API returns.
          return { status: 200, text: fold(JSON.stringify(JSON.parse(body))) };
        if (/^\s*<\?xml/.test(body) && !/<html/i.test(body.slice(0, 2000)))
          return { status: 200, text: fold(body) };
        return { status: 200, text: fold(text(body)) };
      })(),
    );
  return cache.get(url);
}

/** Every source-like object ({ url, quote, retrievedAt }) anywhere in a record file. */
function sourcesIn(value, path = "", out = []) {
  if (Array.isArray(value))
    value.forEach((v, i) => sourcesIn(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object") {
    if (typeof value.url === "string" && typeof value.quote === "string")
      out.push([path, value]);
    for (const [k, v] of Object.entries(value))
      sourcesIn(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}
const attractionFiles = ["content/city-costs/attractions.json"];

let failed = 0;
let unverifiable = 0;
const MANUAL_CHECK_DAYS = 60;
function cannotVerify(label, s, why) {
  if (!s.manualCheck) {
    console.log(`FAIL ${label}: ${why}`);
    failed++;
    return;
  }
  const age = (Date.now() - Date.parse(s.manualCheck.checkedOn)) / 86400000;
  if (age > MANUAL_CHECK_DAYS) {
    console.log(
      `FAIL ${label}: ${why}; manual check of ${s.manualCheck.checkedOn} is over ${MANUAL_CHECK_DAYS} days old`,
    );
    failed++;
    return;
  }
  console.log(
    `UNVERIFIABLE ${label}: ${why}; quote checked by hand on ${s.manualCheck.checkedOn} (${s.manualCheck.note})`,
  );
  unverifiable++;
}
for (const [kind, file, key] of files) {
  for (const r of JSON.parse(readFileSync(file, "utf8")).records) {
    if (only && !only.has(key(r))) continue;
    const sources = [r.source, ...(r.supportingSources ?? [])];
    for (const [i, s] of sources.entries()) {
      const label = `${kind} ${key(r)} from ${r.effectiveFrom}${i ? ` (supporting ${i})` : ""}`;
      try {
        const p = await load(s.url);
        if (p.status !== 200) {
          cannotVerify(label, s, `HTTP ${p.status} ${s.url}`);
        } else if (p.manual) {
          console.log(
            `MANUAL ${label}: ${p.manual} source, check the quote by hand: ${s.url}`,
          );
        } else if (p.text.includes(fold(s.quote))) {
          console.log(
            `ok   ${label}${s.manualCheck ? " (readable again: remove its manualCheck)" : ""}`,
          );
        } else {
          cannotVerify(label, s, `quote not found at ${s.url}`);
        }
      } catch (e) {
        cannotVerify(label, s, e.message);
      }
    }
  }
}
for (const file of attractionFiles) {
  for (const record of JSON.parse(readFileSync(file, "utf8")).records)
    for (const [path, s] of sourcesIn(record)) {
      if (only && !only.has(record.city)) continue;
      const label = `attraction ${record.city} ${record.id} ${path}`;
      try {
        const p = await load(s.url);
        if (p.status !== 200)
          cannotVerify(label, s, `HTTP ${p.status} ${s.url}`);
        else if (p.manual)
          console.log(
            `MANUAL ${label}: ${p.manual} source, check the quote by hand: ${s.url}`,
          );
        else if (p.text.includes(fold(s.quote))) console.log(`ok   ${label}`);
        else cannotVerify(label, s, `quote not found at ${s.url}`);
      } catch (e) {
        cannotVerify(label, s, e.message);
      }
    }
}
if (unverifiable)
  console.log(
    `${unverifiable} source(s) UNVERIFIABLE: verified by hand only; re-check them before their manual check expires.`,
  );
process.exitCode = failed ? 1 : 0;
