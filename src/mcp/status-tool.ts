/**
 * @module mcp/status-tool
 * `libredesk_status`: which profile the tools use, and whether its server answers.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getStatus } from "../services/status.js";
import { jsonContent, PROFILE_FIELD, toolErrorResult, type ToolResult } from "./action-tool.js";

const DESCRIPTION =
  "Show the profile in use and whether its server accepts it, as which agent. Call it on auth, profile or connection errors.";

/** Run the status check for `profile` (or the resolved default) and return it as a tool result. */
export async function statusResult(profile: string | undefined, deps: Parameters<typeof getStatus>[0] = {}): Promise<ToolResult> {
  try {
    return jsonContent(await getStatus({ ...deps, profile: profile || undefined }));
  } catch (error) {
    return toolErrorResult(error);
  }
}

/** Register `libredesk_status`. Its only parameter is `profile`. */
export function registerStatusTool(server: McpServer): void {
  server.registerTool(
    "libredesk_status",
    { description: DESCRIPTION, inputSchema: { profile: PROFILE_FIELD }, annotations: { readOnlyHint: true } },
    async ({ profile }: { profile?: string }) => statusResult(profile),
  );
}
