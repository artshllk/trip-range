import "server-only";
import { neon } from "@neondatabase/serverless";
import { serverEnvironment } from "../providers/server/environment";
import { reportDiagnostic } from "./observability";
import type { AffiliateCount } from "../domain/affiliate";

/** Increment the database-clock UTC bucket once. Never throws and never delays the handoff beyond 800 ms. */
export async function recordAffiliateEvent(e: AffiliateCount): Promise<void> {
  const url = serverEnvironment().fareStore.databaseUrl;
  if (!url) return;
  const sql = neon(url);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      sql`select public.increment_affiliate_count(${e.originCode}, ${e.destinationCode}, ${e.outcome}, ${e.fareAge})`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), 800);
      }),
    ]);
  } catch {
    reportDiagnostic({
      level: "error",
      component: "affiliate",
      operation: "affiliate-event",
      status: "failed",
    });
  } finally {
    clearTimeout(timer);
  }
}
