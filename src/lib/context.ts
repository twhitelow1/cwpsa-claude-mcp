import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = { tokenId: string; via: "mcp" | "rest" };

export const requestContext = new AsyncLocalStorage<RequestContext>();
