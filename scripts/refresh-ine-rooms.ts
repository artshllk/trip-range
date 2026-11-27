/** Full-country INE room ADR snapshot. Writes only after complete validation.
 * --check compares the live source without changing files; --file replays saved evidence.
 * A removed/renamed series needs explicit --accept-schema-change after review. */
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  parseIneRooms,
  validateIneSnapshot,
  inePublishedRooms,
  INE_ROOM_FEED,
  type IneRoomSnapshot,
} from "../src/domain/costs/ine-spain";
import { validatePublishedRooms } from "../src/domain/room-evidence";

const file = "content/rooms/ine-spain.json";
const rawFile = "public/data/room-market-context/ine-source.json";
const publicFile = "public/data/room-market-context/ine-spain.json";
const args = process.argv.slice(2);
const localIndex = args.indexOf("--file");
const localFile = localIndex >= 0 ? args[localIndex + 1] : undefined;
if (
  args.some(
    (a, i) =>
      !["--check", "--file", "--accept-schema-change"].includes(a) &&
      !(localIndex >= 0 && i === localIndex + 1),
  ) ||
  (localIndex >= 0 && !localFile)
)
  throw Error(
    "Usage: refresh-ine-rooms [--check] [--file PATH] [--accept-schema-change]",
  );
async function main() {
  let previous: IneRoomSnapshot | undefined;
  try {
    previous = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (previous) validateIneSnapshot(previous);
  const raw = localFile
    ? await readFile(localFile, "utf8")
    : await (async () => {
        const response = await fetch(INE_ROOM_FEED, {
          signal: AbortSignal.timeout(25000),
        });
        if (!response.ok)
          throw Error(
            `INE HTTP ${response.status}; existing snapshot retained`,
          );
        return response.text();
      })();
  const observations = parseIneRooms(JSON.parse(raw));
  if (observations.length < 100)
    throw Error(
      "INE: unexpectedly small national table; existing snapshot retained",
    );
  if (previous && !args.includes("--accept-schema-change")) {
    for (const old of previous.observations) {
      const next = observations.find((r) => r.seriesId === old.seriesId);
      if (
        !next ||
        next.municipality !== old.municipality ||
        next.period < old.period
      )
        throw Error(
          `INE: removed, renamed or regressed series ${old.seriesId}; review required`,
        );
    }
  }
  const snapshot: IneRoomSnapshot = {
    schemaVersion: 1,
    table: "46298",
    fetchedAt: new Date().toISOString(),
    sourceUrl: INE_ROOM_FEED,
    sha256: createHash("sha256").update(raw).digest("hex"),
    observations,
  };
  validateIneSnapshot(snapshot);
  validatePublishedRooms(inePublishedRooms(snapshot));
  const unchanged =
    previous &&
    JSON.stringify(previous.observations) === JSON.stringify(observations);
  const summary = {
    status: unchanged
      ? "unchanged"
      : args.includes("--check")
        ? "would-update"
        : "updated",
    municipalities: observations.length,
    available: observations.filter((r) => r.status === "available").length,
    suppressed: observations
      .filter((r) => r.status === "suppressed")
      .map((r) => r.municipality),
    missing: observations
      .filter((r) => r.status === "missing")
      .map((r) => r.municipality),
    periods: [...new Set(observations.map((r) => r.period))],
  };
  if (!unchanged && !args.includes("--check")) {
    // Stage all validated contents before replacing any tracked file. Never write a
    // partial API response over the last usable snapshot.
    await mkdir("public/data/room-market-context", { recursive: true });
    const data = JSON.stringify(snapshot, null, 2) + "\n";
    for (const [path, content] of [
      [file, data],
      [publicFile, data],
      [rawFile, raw],
    ])
      await writeFile(path + ".tmp", content);
    for (const path of [file, publicFile, rawFile])
      await rename(path + ".tmp", path);
  }
  console.log(JSON.stringify(summary, null, 2));
}
main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : "INE refresh failed; existing snapshot retained",
  );
  process.exitCode = 1;
});
