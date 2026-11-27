import { evidenceResponse } from "@/server/public-evidence";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return evidenceResponse(request, "/methodology");
}

export const HEAD = GET;
