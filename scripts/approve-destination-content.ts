import { approveDestinationContent } from "./lib/editorial-commands";
approveDestinationContent(process.argv.slice(2))
  .then((report) => console.log(JSON.stringify(report, null, 2)))
  .catch((error) => {
    console.error(
      `Content not approved: ${error instanceof Error ? error.message : "invalid-input"}`,
    );
    process.exitCode = 1;
  });
