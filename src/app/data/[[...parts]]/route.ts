import { evidenceResponse } from "@/server/public-evidence";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ parts?: string[] }> };

export async function GET(request: Request, context: Context) {
  const { parts = [] } = await context.params;
  return evidenceResponse(request, ["", "data", ...parts].join("/"));
}

export const HEAD = GET;
