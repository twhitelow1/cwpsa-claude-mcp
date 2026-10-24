import { handleCron } from "@/lib/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Called by Vercel Cron (see vercel.json) with Authorization: Bearer ${CRON_SECRET}. */
export function GET(req: Request) {
  return handleCron(req);
}
