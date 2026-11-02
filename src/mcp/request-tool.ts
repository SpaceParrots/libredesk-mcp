/**
 * @module mcp/request-tool
 * `libredesk_request`: a raw call to any `/api/v1/` path, and the catalog of every declared
 * operation, for what the domain tools do not cover.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConfirmationRequiredError, InputError } from "../errors.js";
import type { Domain } from "../ops/define.js";
import { buildCatalog } from "../ops/catalog.js";
import { rawRequest } from "../services/raw-request.js";
import { actionTool, jsonContent, type ActionMap } from "./action-tool.js";

const DESCRIPTION = "Raw API access for what other tools lack; find the endpoint with catalog first.";

/** The `call` and `catalog` actions over `domains`. */
export function requestActions(domains: readonly Domain[]): ActionMap {
  return {
    call: {
      summary: "Send one request. DESTRUCTIVE for DELETE: needs confirm.",
      shape: {
        method: z.enum(["GET", "POST", "PUT", "DELETE"]).describe("HTTP method."),
        path: z.string().describe('Path under /api/v1/, for example "/api/v1/help-centers/3".'),
        query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe("Query parameters."),
        body: z.unknown().optional().describe("JSON request body."),
        confirm: z.boolean().optional().describe("true for DELETE, once the user agreed."),
      },
      handler: async (args) => {
        const input = args as unknown as Parameters<typeof rawRequest>[0];
        if (input.method === "DELETE" && input.confirm !== true) {
          throw new ConfirmationRequiredError(`DELETE ${input.path} deletes data.`, {
            hint: "Ask the user, then call again with confirm: true.",
          });
        }
        return jsonContent(await rawRequest(input));
      },
    },
    catalog: {
      summary: "List known endpoints; with domain, also their fields.",
      shape: { domain: z.string().optional().describe('Domain or tool name, for example "articles".') },
      handler: (args) => {
        const domain = args.domain as string | undefined;
        const entries = buildCatalog(domains, domain);
        if (entries.length === 0) {
          throw new InputError(`No domain "${domain ?? ""}".`, { hint: `Known domains: ${domains.map((d) => d.name).join(", ")}.` });
        }
        if (domain !== undefined) return Promise.resolve(jsonContent(entries));
        const rows = entries.map(({ tool, action, method, path, impact, summary }) => ({ tool, action, method, path, impact, summary }));
        return Promise.resolve(jsonContent(rows));
      },
    },
  };
}

/** Register `libredesk_request`. The catalog lists `domains`. */
export function registerRequestTool(server: McpServer, domains: readonly Domain[]): void {
  actionTool(server, "libredesk_request", DESCRIPTION, requestActions(domains), { readOnlyHint: false, destructiveHint: true });
}
