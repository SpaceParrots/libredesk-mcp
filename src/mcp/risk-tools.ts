/**
 * @module mcp/risk-tools
 * The two shared MCP tools that hold the risky actions of every selected domain:
 * `libredesk_publish` (what customers and AI assistants see, and paid switches) and
 * `libredesk_delete` (deletes). Clients set permissions per tool name, so with these split out a
 * user can allow the domain tools once and keep a confirmation on publishing and deleting.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { riskActionName, riskToolOf, type Domain, type Operation, type RiskTool } from "../ops/define.js";
import { runOperation } from "../ops/run.js";
import { actionTool, jsonContent, type ActionMap, type ActionToolAnnotations } from "./action-tool.js";
import { ALL_UNDOCUMENTED, riskToolName } from "./domain-tool.js";

interface RiskToolSpec {
  readonly description: string;
  readonly annotations: ActionToolAnnotations;
}

const SPECS: Readonly<Record<RiskTool, RiskToolSpec>> = {
  publish: {
    description: "Change what customers and AI assistants see: publish articles and collections, take help centers online or offline, switch FAQ learning.",
    // help_center_toggle flips the state, so a repeated call is not a no-op. It can also take a help
    // center offline, so clients that ask before destructive tools ask here too.
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  },
  delete: {
    description: "Delete help centers, collections, articles and snippets. Deletes cannot be undone.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
};

/** The summary of a risky action: what it does and what follows from it; the tool itself says it is risky. */
function riskSummary(op: Operation, markUndocumented: boolean): string {
  const undocumented = markUndocumented && op.undocumented ? " [undocumented]" : "";
  const effect = op.effect ? ` ${op.effect}` : "";
  const escalate = op.escalate ? ` When ${op.escalate.condition}: ${op.escalate.effect}` : "";
  return `${op.summary}${undocumented}${effect}${escalate}`;
}

function riskOps(domains: readonly Domain[], tool: RiskTool): { domain: Domain; op: Operation }[] {
  return domains.flatMap((domain) =>
    domain.operations.filter((op) => op.mcp !== false && riskToolOf(op) === tool).map((op) => ({ domain, op })),
  );
}

/**
 * The actions of one shared tool across `domains`, named by {@link riskActionName}. Throws when
 * two domains would give the same action name. `run` is replaceable in tests.
 */
export function riskActions(domains: readonly Domain[], tool: RiskTool, run: typeof runOperation = runOperation): ActionMap {
  const entries = riskOps(domains, tool);
  const markUndocumented = !entries.every(({ op }) => op.undocumented === true);
  const actions: Record<string, ActionMap[string]> = {};
  for (const { domain, op } of entries) {
    const name = riskActionName(domain, op);
    if (Object.hasOwn(actions, name)) throw new Error(`${riskToolName(tool)}: duplicate action ${name}`);
    actions[name] = {
      summary: riskSummary(op, markUndocumented),
      shape: op.input,
      handler: async (args) => jsonContent(await run(op, args, { caller: "mcp" })),
    };
  }
  return actions;
}

/** Register `libredesk_publish` and `libredesk_delete` for the selected domains; a tool with no actions is left out. */
export function registerRiskTools(server: McpServer, domains: readonly Domain[]): void {
  for (const tool of ["publish", "delete"] as const) {
    const actions = riskActions(domains, tool);
    if (Object.keys(actions).length === 0) continue;
    const allUndocumented = riskOps(domains, tool).every(({ op }) => op.undocumented === true);
    const { description, annotations } = SPECS[tool];
    actionTool(server, riskToolName(tool), allUndocumented ? `${description} ${ALL_UNDOCUMENTED}` : description, actions, annotations);
  }
}
