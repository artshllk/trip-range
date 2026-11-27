import { serverEnvironment } from "../../../providers/server/environment";
export const dynamic = "force-dynamic";
export async function GET() {
  const config = serverEnvironment();
  return Response.json(
    {
      status: "ok",
      version: "0.1.0",
      capabilities: config.capabilities,
    },
    { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
  );
}
