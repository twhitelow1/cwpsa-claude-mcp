import { createMcpHandler } from "mcp-handler";
import { writesEnabled } from "@/lib/config";
import { requestContext } from "@/lib/context";
import { guard, preflight } from "@/lib/guard";
import { runTool } from "@/lib/run";
import { readTools, writeTools } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const INSTRUCTIONS =
  "ConnectWise PSA bridge for DubLow Digital. Read tools are safe to call freely. Write tools (if listed) always " +
  "return a dry_run preview + confirm_token first: show the preview to the user, get explicit approval, then call " +
  "again with identical arguments plus confirm_token. Never fabricate ids — look them up with the list/search tools.";

const mcp = createMcpHandler(
  (server) => {
    const tools = writesEnabled() ? [...readTools, ...writeTools] : readTools;
    for (const tool of tools) {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.input.shape,
          annotations: { readOnlyHint: !tool.write, destructiveHint: false, idempotentHint: !tool.write, openWorldHint: true },
        },
        async (args: unknown) => {
          const r = await runTool(tool, args);
          return r.ok
            ? { content: [{ type: "text" as const, text: JSON.stringify(r.data) }] }
            : { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: r.code, message: r.message }) }] };
        },
      );
    }
  },
  { serverInfo: { name: "dublow-connectwise-bridge", version: "0.1.0" }, instructions: INSTRUCTIONS },
  { basePath: "/api", maxDuration: 60, disableSse: true, verboseLogs: false },
);

async function handler(req: Request): Promise<Response> {
  const g = guard(req);
  if ("response" in g) return g.response;
  return requestContext.run({ tokenId: g.tokenId, via: "mcp" }, () => mcp(req));
}

export { handler as GET, handler as POST, handler as DELETE, preflight as OPTIONS };
