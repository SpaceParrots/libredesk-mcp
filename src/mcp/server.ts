/**
 * @module mcp/server
 * The MCP server on stdio: one action-dispatch tool per selected domain, the shared
 * `libredesk_publish` and `libredesk_delete` tools for their risky actions, plus `libredesk_request`
 * and `libredesk_status`. stdout carries the protocol, so diagnostics go to stderr only. Startup
 * never resolves a profile: without one, the tools still list and each call explains how to log in.
 */

import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ENV, PACKAGE_NAME } from "../constants.js";
import { DOMAINS } from "../domains/index.js";
import { ConfigError } from "../errors.js";
import type { Domain, Toolset } from "../ops/define.js";
import { registerDomainTool } from "./domain-tool.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { registerRequestTool } from "./request-tool.js";
import { registerRiskTools } from "./risk-tools.js";
import { registerStatusTool } from "./status-tool.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

/** Every toolset, in the order shown in error messages. */
export const TOOLSETS: readonly Toolset[] = ["knowledge", "ai", "workflow", "support", "core"];

/** Toolsets on when `LIBREDESK_TOOLSETS` is unset: all but `support`. */
const DEFAULT_TOOLSETS: ReadonlySet<Toolset> = new Set(TOOLSETS.filter((t) => t !== "support"));

/**
 * Parse `LIBREDESK_TOOLSETS`: a comma-separated list of toolsets, or `all`. Unset or empty means
 * every toolset but `support`. Unknown names throw a {@link ConfigError} listing the valid ones.
 */
export function parseToolsets(value: string | undefined): ReadonlySet<Toolset> | "all" {
  const names = (value ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  if (names.length === 0) return DEFAULT_TOOLSETS;
  if (names.includes("all")) return "all";
  const unknown = names.filter((name) => !(TOOLSETS as readonly string[]).includes(name));
  if (unknown.length > 0) {
    throw new ConfigError(`Unknown toolset ${unknown.map((n) => `"${n}"`).join(", ")} in ${ENV.TOOLSETS}.`, {
      hint: `Valid toolsets: ${TOOLSETS.join(", ")}, or all.`,
    });
  }
  return new Set(names as Toolset[]);
}

/** The domains whose toolset is selected. `core` is always on. */
export function selectDomains(domains: readonly Domain[], toolsets: ReadonlySet<Toolset> | "all"): Domain[] {
  return domains.filter((domain) => toolsets === "all" || domain.toolset === "core" || toolsets.has(domain.toolset));
}

/** Register the tools selected by `LIBREDESK_TOOLSETS` in `env`. The catalog always covers every domain. */
export function registerTools(server: McpServer, env: NodeJS.ProcessEnv = process.env): void {
  const domains = selectDomains(DOMAINS, parseToolsets(env[ENV.TOOLSETS]));
  for (const domain of domains) registerDomainTool(server, domain);
  registerRiskTools(server, domains);
  registerRequestTool(server, DOMAINS);
  registerStatusTool(server);
}

/** Create the server with its tools registered, not yet connected. */
export function createMcpServer(env: NodeJS.ProcessEnv = process.env): McpServer {
  const server = new McpServer({ name: PACKAGE_NAME, version: pkg.version }, { instructions: SERVER_INSTRUCTIONS });
  registerTools(server, env);
  return server;
}

/** Start the MCP server on stdio. Resolves once connected; the process then lives on the open stdin. */
export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
  process.stderr.write(`${PACKAGE_NAME} MCP server ${pkg.version} running on stdio\n`);
}
