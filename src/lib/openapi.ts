import { z } from "zod";
import { restRoutes } from "./rest";
import { toolByName } from "./tools";

export function buildOpenApi(serverUrl?: string) {
  const paths: Record<string, unknown> = {};
  for (const r of restRoutes) {
    const tool = toolByName.get(r.tool);
    if (!tool) continue;
    const shape = tool.input.shape as Record<string, z.ZodType>;
    const pathParams = new Set(r.params ?? []);
    const parameters = Object.entries(shape).map(([name, schema]) => {
      const js = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
      const { description, $schema: _s, ...rest } = js;
      return {
        name,
        in: pathParams.has(name) ? "path" : "query",
        required: pathParams.has(name) || !schema.safeParse(undefined).success,
        description,
        schema: rest,
      };
    });
    const oaPath = "/api/v1/" + r.pattern.replace(/:([a-z_]+)/g, "{$1}");
    paths[oaPath] = {
      get: {
        operationId: r.tool,
        summary: r.summary,
        description: tool.description,
        parameters,
        responses: {
          "200": { description: "Compact JSON result", content: { "application/json": { schema: { type: "object" } } } },
          "400": { $ref: "#/components/responses/Error" },
          "401": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
          "429": { $ref: "#/components/responses/Error" },
          "502": { $ref: "#/components/responses/Error" },
        },
      },
    };
  }
  return {
    openapi: "3.0.3",
    info: {
      title: "DubLow ConnectWise Bridge",
      version: "0.1.0",
      description: "Read-only REST mirror of the ConnectWise PSA MCP tools. All endpoints require a bearer token.",
    },
    servers: serverUrl ? [{ url: serverUrl }] : [],
    security: [{ bearerAuth: [] }],
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      responses: {
        Error: {
          description: "Error",
          content: {
            "application/json": {
              schema: { type: "object", properties: { error: { type: "string" }, message: { type: "string" } }, required: ["error"] },
            },
          },
        },
      },
    },
  };
}
