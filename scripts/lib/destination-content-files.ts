import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

/** Offline audit only. O(n) manifest agreement; bounded individual files, no global city cap. */
export function checkDestinationContentFiles(
  directory: string,
  manifestRecords: readonly unknown[],
  idKey:
    | "destinationId"
    | "subject"
    | "destinationSubject"
    | "id" = "destinationId",
): { ok: true; files: number } | { ok: false; errors: string[] } {
  try {
    const directoryStat = lstatSync(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink())
      throw Error("directory");
    const remaining = new Map<string, unknown>();
    for (const record of manifestRecords) {
      const id =
        record && typeof record === "object"
          ? (record as Record<string, unknown>)[idKey]
          : undefined;
      if (typeof id !== "string" || remaining.has(id)) throw Error("id");
      remaining.set(id, record);
    }
    const names = readdirSync(directory).filter((name) =>
      name.endsWith(".json"),
    );
    for (const name of names) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}\.json$/.test(name))
        throw Error("filename");
      const file = join(directory, name),
        stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256_000)
        throw Error("file");
      const raw = readFileSync(file, "utf8");
      if (Buffer.byteLength(raw) > 256_000) throw Error("size");
      const record = JSON.parse(raw),
        id = record?.[idKey];
      if (!remaining.has(id) || !isDeepStrictEqual(remaining.get(id), record))
        return { ok: false, errors: ["record-not-in-static-manifest"] };
      remaining.delete(id);
    }
    if (remaining.size)
      return { ok: false, errors: ["manifest-record-file-missing"] };
    return { ok: true, files: names.length };
  } catch {
    return { ok: false, errors: ["unreadable-or-malformed-record-files"] };
  }
}
