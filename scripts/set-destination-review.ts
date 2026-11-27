import { setDestinationReview } from "./lib/editorial-commands";
try {
  console.log(
    JSON.stringify(setDestinationReview(process.argv.slice(2)), null, 2),
  );
} catch (error) {
  console.error(
    `Review not changed: ${error instanceof Error ? error.message : "invalid-input"}`,
  );
  process.exitCode = 1;
}
