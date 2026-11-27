import "server-only";
import { evidenceMode } from "../providers/server/environment";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

const directory = join(process.cwd(), ".evidence-build");
const pages = new Set([
  "/data",
  "/data/municipal-hotel-scaling/2025-v1",
  "/methodology",
  "/data/fare-coverage/2026-11-05-v1",
]);
type FileRecord = { path: string; contentType: string; bytes: number };
type Delivery = { publishedAt: string | null; files: FileRecord[] };
let index:
  | Promise<{ date: string | null; files: Map<string, FileRecord> }>
  | undefined;

function getIndex() {
  return (index ??= readFile(join(directory, "delivery.json"), "utf8").then(
    (raw) => {
      const manifest: Delivery = JSON.parse(raw);
      return {
        date: manifest.publishedAt,
        files: new Map(manifest.files.map((file) => [file.path, file])),
      };
    },
  ));
}

export async function evidenceResponse(
  request: Request,
  pathname: string,
): Promise<Response> {
  const mode = evidenceMode();
  const absent = () =>
    new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
    });
  if (mode === "off") return absent();
  if (
    mode === "candidate" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname)
  )
    return absent();
  const bundle = await getIndex();
  if ((mode !== "candidate") !== Boolean(bundle.date)) return absent();
  if (pages.has(pathname)) {
    const page =
      mode === "release" && pathname === "/data"
        ? "catalogue-before-acceptance"
        : pathname.slice(1);
    const bytes = await readFile(join(directory, "pages", page + ".html"));
    return new Response(
      request.method === "HEAD" ? null : new Uint8Array(bytes),
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=0, must-revalidate",
          ...(mode === "candidate" ? { "X-Robots-Tag": "noindex" } : {}),
        },
      },
    );
  }
  const file = bundle.files.get(pathname);
  if (!file) return absent();
  const name = basename(file.path);
  const disposition = /\.(csv|sql|py|mjs|gz)$/.test(name)
    ? "attachment"
    : "inline";
  const bytes =
    request.method === "HEAD"
      ? null
      : new Uint8Array(await readFile(join(directory, file.path)));
  return new Response(bytes, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.bytes),
      "Content-Disposition": disposition + '; filename="' + name + '"',
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "Content-Disposition",
    },
  });
}
