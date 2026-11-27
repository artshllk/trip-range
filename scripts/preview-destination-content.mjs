/** Local operator preview only. No Next route, content mutation, research or approval. */
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { previewMediaFile } from "./lib/content-preview-media.mjs";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function parsePreviewArguments(args, env = process.env) {
  if (env.NODE_ENV === "production" || env.VERCEL) throw Error("local-only");
  const flags = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (
      !["--destination", "--locale", "--port", "--nights", "--pilot"].includes(
        args[i],
      ) ||
      !args[i + 1] ||
      flags.has(args[i])
    )
      throw Error("invalid-arguments");
    flags.set(args[i], args[i + 1]);
  }
  const destination = flags.get("--destination");
  const locale = flags.get("--locale") ?? "en";
  const port = flags.get("--port") ?? "4173";
  const nights = flags.get("--nights") ?? "2";
  const pilot = flags.get("--pilot");
  if (
    !destination ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_:-]{0,119}$/.test(destination) ||
    !["en"].includes(locale) ||
    !["2", "3"].includes(nights) ||
    (pilot !== undefined &&
      (pilot !== "phase2" || !["vienna", "london"].includes(destination))) ||
    !/^\d{4,5}$/.test(port) ||
    +port < 1024 ||
    +port > 65535
  )
    throw Error("invalid-arguments");
  return {
    destination,
    locale,
    port: +port,
    nights: +nights,
    ...(pilot ? { pilot } : {}),
  };
}

export async function startContentPreview(options) {
  // Full validator and file/manifest agreement must pass before a listener exists.
  execFileSync(
    process.execPath,
    [
      "--conditions=react-server",
      "-e",
      `
    const { runContentReviewCommand } = require('./.content-build/scripts/review-destination-content.js');
    let record;
    if (process.argv[2] === 'phase2') {
      if (!['vienna', 'london'].includes(process.argv[1])) process.exit(1);
      const { readFileSync } = require('node:fs');
      record = JSON.parse(readFileSync('docs/research/destination-content/phase2/' + process.argv[1] + '.json', 'utf8'));
      const { placeRegistryData } = require('./.content-build/content/places/records.js');
      const identity = JSON.parse(readFileSync('docs/research/destination-content/phase2/vienna-identity.json', 'utf8'));
      const identities = [...placeRegistryData.records, identity];
      const { validateDestinationContentData } = require('./.content-build/src/domain/destination-content/validation.js');
      if (!validateDestinationContentData({schemaVersion:1, records:[record]}, {identities,mediaSubjects:identities.map(p=>p.subject)}).ok) process.exit(1);
    } else {
      runContentReviewCommand(['--destination', process.argv[1]]);
      const { destinationContentData } = require('./.content-build/content/destinations/records.js');
      record = destinationContentData.records.find(r => r.destinationId === process.argv[1]);
    }
    const items = [record, record.overview, ...(record.highlights || []), ...(record.attractions || []), ...(record.areas || []), ...(record.transport || []), ...(record.practicalNotes || []), ...(record.dayTemplates || [])].filter(Boolean);
    if (items.some(r => r.reviewStatus !== 'draft' || r.reviewedAt !== null)) process.exit(1);
  `,
      options.destination,
      options.pilot ?? "",
    ],
    { stdio: "pipe" },
  );
  const { build } = await import("esbuild");
  const files = readdirSync(".next/static", { recursive: true }).filter(
    (name) => typeof name === "string",
  );
  const css = files
    .filter((name) => name.endsWith(".css"))
    .map((name) => readFileSync(resolve(".next/static", name), "utf8"))
    .join("\n");
  if (css.length < 1000) throw Error("build-required");
  const bundle = await build({
    entryPoints: ["tests/fixtures/destination-content-pilot-browser.tsx"],
    bundle: true,
    write: false,
    platform: "browser",
    jsx: "automatic",
    define: {
      "process.env": "{}",
      "process.env.NODE_ENV": '"production"',
      "process.env.__NEXT_IMAGE_OPTS": JSON.stringify({
        deviceSizes: [640, 1080],
        imageSizes: [32, 64],
        path: "/_next/image",
        loader: "default",
        unoptimized: true,
        remotePatterns: [],
      }),
    },
  });
  const origin = `http://127.0.0.1:${options.port}`;
  const search = new URLSearchParams({
    destination: options.destination,
    locale: options.locale,
    nights: String(options.nights ?? 2),
    ...(options.pilot ? { pilot: options.pilot } : {}),
  });
  const url = `${origin}/?${search}`;
  const server = createServer((request, response) => {
    response.setHeader("X-Robots-Tag", "noindex, nofollow");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    if (
      request.headers.host !== `127.0.0.1:${options.port}` ||
      (request.headers.origin && request.headers.origin !== origin)
    ) {
      response.writeHead(403);
      return response.end();
    }
    const path = new URL(request.url, origin);
    if (
      path.pathname === "/api/affiliate/flights" &&
      request.method === "POST"
    ) {
      response.writeHead(503, { "Content-Type": "application/json" });
      return response.end('{"status":"unavailable"}');
    }
    if (request.method !== "GET") {
      response.writeHead(405);
      return response.end();
    }
    const media = previewMediaFile(path.pathname);
    if (media) {
      response.setHeader("Content-Type", "image/webp");
      return response.end(readFileSync(media));
    }
    if (path.pathname === "/fixture.js") {
      response.setHeader("Content-Type", "application/javascript");
      return response.end(bundle.outputFiles[0].contents);
    }
    if (
      path.pathname.startsWith("/_next/static/") &&
      files.includes(path.pathname.slice(14))
    ) {
      response.setHeader(
        "Content-Type",
        path.pathname.endsWith(".woff2")
          ? "font/woff2"
          : "application/octet-stream",
      );
      return response.end(
        readFileSync(resolve(".next/static", path.pathname.slice(14))),
      );
    }
    if (path.pathname === "/favicon.ico") {
      response.writeHead(204);
      return response.end();
    }
    if (path.pathname !== "/") {
      response.writeHead(404);
      return response.end(
        "Local preview only. Use your normal development server for product navigation.",
      );
    }
    if (path.search !== `?${search}`) {
      response.writeHead(302, { Location: url });
      return response.end();
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(`<!doctype html><html lang="${options.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>DRAFT — NOT PUBLISHED · GoEksplo</title><style>${css}
      .pilot-draft-banner{padding:12px max(16px,calc((100vw - 1120px)/2));background:#fff3d6;color:#593700;border-bottom:1px solid #bc8100}.pilot-draft-banner strong{font-size:13px}.pilot-draft-banner p{font-size:12px;max-width:80ch;margin-top:4px}
      </style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  });
  server.listen(options.port, "127.0.0.1");
  await once(server, "listening");
  console.log(
    `DRAFT — NOT PUBLISHED\n${url}\nLocal preview. Synthetic trip prices/dates; booking disabled. Zero research calls. Stop with Ctrl+C.`,
  );
  return server;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const server = await startContentPreview(
      parsePreviewArguments(process.argv.slice(2)),
    );
    for (const signal of ["SIGINT", "SIGTERM"])
      process.once(signal, () => {
        server.close();
        server.closeAllConnections();
      });
  } catch {
    console.error(
      "Preview unavailable. Use local development, a valid all-draft destination, an unused loopback port and a current npm run build. Usage: npm run preview:destination-content -- --destination <id> [--locale en] [--port 4173] [--nights 2|3] [--pilot phase2]",
    );
    process.exitCode = 1;
  }
}
