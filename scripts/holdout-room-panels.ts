/**
 * Leave-one-out holdout, scheduled for 18 November 2026 (all five panels exist from
 * 17 November). Prints a pending result; nothing is written into src.
 *
 *   npm run holdout:room-panels -- --pli snapshot.json --run-date 2026-11-18 \
 *     vienna.json milan.json barcelona.json istanbul.json london.json
 *
 * Inputs are the figures printed by derive:room-panel (pending or reviewed) and the
 * price-level snapshot printed by snapshot:eurostat. London has no price level, so
 * it is neither predicted nor a donor.
 */
import { readFileSync } from "node:fs";
import { describeHoldout, runHoldout } from "../src/domain/costs/holdout";
import type { RoomPanelFigure } from "../src/domain/costs/room-panel";
import type { EurostatSeries } from "../src/domain/costs/eurostat";

const args = process.argv.slice(2);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const pli = value("--pli"),
  runDate = value("--run-date");
const files = args.filter(
  (a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"),
);
if (!pli || !runDate || !files.length) {
  console.error(
    "Usage: npm run holdout:room-panels -- --pli <snapshot.json> --run-date YYYY-MM-DD <figure.json>...",
  );
  process.exit(1);
}
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const snapshot = read(pli) as EurostatSeries;
const result = runHoldout(
  files.map(read) as RoomPanelFigure[],
  snapshot.priceLevels,
  runDate,
);
process.stdout.write(JSON.stringify(result, null, 2) + "\n");
console.error(
  [
    `${result.pairs.length} held-out anchors (London cannot take part: no price level).`,
    ...describeHoldout(result),
    'After review set review.status "reviewed" and put it in reviewed-stay-data.ts as `holdout`.',
  ].join("\n"),
);
