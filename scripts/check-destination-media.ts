import { localMediaFileErrors } from "./lib/media-local-files";
import { placeIdentities } from "../src/places/runtime/registry";
import { validatePlaceRegistry } from "../src/domain/places/validation";
import { validateHistoricalMedia } from "./lib/media-history";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  validateMediaRegistry,
  validateMediaChanges,
} from "../src/domain/media/validation";
function parse(raw: string) {
  if (Buffer.byteLength(raw) > 2_000_000) throw Error("size");
  return validateMediaRegistry(JSON.parse(raw), placeIdentities);
}
function main() {
  const args = process.argv.slice(2);
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (
      !["--file", "--previous", "--previous-places"].includes(args[i]) ||
      !args[i + 1] ||
      flags.has(args[i])
    )
      throw Error("usage");
    flags.set(args[i], args[i + 1]);
  }
  const file = flags.get("--file") ?? "content/media/approved.json";
  const result = parse(readFileSync(file, "utf8"));
  let previous: ReturnType<typeof parse> | undefined;
  if (flags.has("--previous-places") && !flags.has("--previous"))
    throw Error("usage");
  if (flags.has("--previous")) {
    const oldPlaces = flags.has("--previous-places")
      ? validatePlaceRegistry(
          JSON.parse(readFileSync(flags.get("--previous-places")!, "utf8")),
        )
      : undefined;
    if (oldPlaces && !oldPlaces.ok) throw Error("invalid-previous-places");
    const old = JSON.parse(readFileSync(flags.get("--previous")!, "utf8"));
    if (old.schemaVersion === 2 && !oldPlaces)
      throw Error("previous-places-required");
    previous = validateHistoricalMedia(
      old,
      oldPlaces?.ok ? oldPlaces.data.records : undefined,
    );
  } else if (!flags.has("--file")) {
    // First addition has no HEAD record. Later changes must preserve revision/rejection history.
    const tracked = execFileSync(
      "git",
      ["ls-tree", "--name-only", "HEAD", "--", file],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    if (tracked) {
      const gitRead = (path: string) =>
        execFileSync("git", ["show", `HEAD:${path}`], {
          encoding: "utf8",
          maxBuffer: 2_000_000,
          stdio: ["ignore", "pipe", "ignore"],
        });
      const old = JSON.parse(gitRead(file));
      let oldPlaces;
      if (old.schemaVersion === 2) {
        const names = execFileSync(
          "git",
          ["ls-tree", "-r", "--name-only", "HEAD", "--", "content/places"],
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
        )
          .trim()
          .split("\n")
          .filter((name) => name.endsWith(".json"));
        const checked = validatePlaceRegistry({
          schemaVersion: 1,
          records: names.map((name) => JSON.parse(gitRead(name))),
        });
        if (!checked.ok) throw Error("invalid-historical-places");
        oldPlaces = checked.data.records;
      }
      previous = validateHistoricalMedia(old, oldPlaces);
    }
  }
  const errors = [
    ...result.errors,
    ...(result.ok ? localMediaFileErrors(result.data.assets) : []),
    ...(previous && !previous.ok ? ["invalid-previous-store"] : []),
    ...(result.ok && previous?.ok
      ? validateMediaChanges(result.data, previous.data)
      : []),
  ];
  console.log(
    JSON.stringify(
      result.ok && !errors.length
        ? {
            status: "passed",
            mode: "offline",
            externalCalls: 0,
            previousRevisionChecked: !!previous,
            places: result.data.places.length,
            assets: result.data.assets.length,
            selections: result.data.selections.length,
            rejections: result.data.rejections.length,
          }
        : { status: "failed", errors },
      null,
      2,
    ),
  );
  process.exitCode = errors.length ? 1 : 0;
}
try {
  main();
} catch {
  console.error(
    "Media validation failed: unreadable, oversized or malformed input. Usage: check:destination-media [--file path] [--previous path]",
  );
  process.exitCode = 1;
}
