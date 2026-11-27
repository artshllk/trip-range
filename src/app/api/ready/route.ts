import { serverEnvironment } from "../../../providers/server/environment";
import { launchReadiness } from "../../../config/readiness";
export const dynamic = "force-dynamic";
export async function GET() {
  const report = launchReadiness(serverEnvironment());
  return Response.json(
    {
      status: report.ready ? "ready" : "not-ready",
      blockers: [...report.configuration, ...report.manual],
    },
    {
      status: report.ready ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}
