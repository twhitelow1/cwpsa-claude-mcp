import { handleGhlWebhook } from "@/lib/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handleGhlWebhook(req);
}
