import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { MediaAsset } from "../../src/domain/media/types";

/** Offline only: verify deployed bytes, not just CSS dimensions or manifest claims. */
export function localMediaFileErrors(
  assets: readonly MediaAsset[],
  publicRoot = resolve("public"),
): string[] {
  const errors: string[] = [];
  for (const asset of assets)
    for (const variant of asset.localDelivery?.variants ?? []) {
      try {
        const path = join(publicRoot, variant.src);
        if (
          !realpathSync(path).startsWith(realpathSync(publicRoot) + sep) ||
          !lstatSync(path).isFile() ||
          lstatSync(path).isSymbolicLink() ||
          lstatSync(path).size !== variant.bytes
        )
          throw Error();
        const bytes = readFileSync(path);
        if (
          createHash("sha256").update(bytes).digest("hex") !== variant.sha256 ||
          bytes.toString("ascii", 0, 4) !== "RIFF" ||
          bytes.toString("ascii", 8, 12) !== "WEBP" ||
          bytes.readUInt32LE(4) + 8 !== bytes.length
        )
          throw Error();
        const chunk = bytes.toString("ascii", 12, 16);
        let width: number, height: number;
        if (
          chunk === "VP8 " &&
          bytes.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))
        ) {
          width = bytes.readUInt16LE(26) & 0x3fff;
          height = bytes.readUInt16LE(28) & 0x3fff;
        } else if (chunk === "VP8X") {
          width = bytes.readUIntLE(24, 3) + 1;
          height = bytes.readUIntLE(27, 3) + 1;
        } else if (chunk === "VP8L" && bytes[20] === 0x2f) {
          const bits = bytes.readUInt32LE(21);
          width = (bits & 0x3fff) + 1;
          height = ((bits >>> 14) & 0x3fff) + 1;
        } else throw Error();
        if (width !== variant.width || height !== variant.height) throw Error();
      } catch {
        errors.push(`${asset.id}:local-file-integrity-failed:${variant.src}`);
      }
    }
  return errors;
}
