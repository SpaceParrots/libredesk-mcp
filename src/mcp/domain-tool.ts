/**
 * @module mcp/domain-tool
 * Turns a {@link Domain} into one action-dispatch MCP tool: one action per operation, run through
 * {@link runOperation}.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Domain, Impact, Operation } from "../ops/define.js";
import { runOperation } from "../ops/run.js";
import { actionTool, jsonContent, type ActionMap } from "./action-tool.js";

/** Appended to the tool description when every action of the domain is undocumented. */
export const ALL_UNDOCUMENTED = "Uses undocumented endpoints.";

function riskLabel(impact: Impact): string | undefined {
  if (impact === "destructive") return "DESTRUCTIVE";
  return impact === "caution" ? "CAUTION" : undefined;
}

/**
 * The action summary: the operation summary, plus ` [undocumented]` when asked, plus the caution
 * or destructive effect, plus an escalation as `CAUTION when <condition>: <effect>`.
 */
export function actionSummary(op: Operation, markUndocumented = true): string {
  const undocumented = markUndocumented && op.undocumented ? " [undocumented]" : "";
  const label = riskLabel(op.impact);
  const risk = label === undefined ? "" : ` ${label}: ${op.effect ?? ""}`;
  const escalate = op.escalate === undefined ? "" : ` ${riskLabel(op.escalate.impact) ?? ""} when ${op.escalate.condition}: ${op.escalate.effect}`;
  return `${op.summary}${undocumented}${risk}${escalate}`;
}

function exposed(domain: Domain): Operation[] {
  return domain.operations.filter((op) => op.mcp !== false);
}

function allUndocumented(ops: readonly Operation[]): boolean {
  return ops.every((op) => op.undocumented === true);
}

/**
 * One action per operation of `domain`, leaving out operations with `mcp: false`. Each action is
 * marked `[undocumented]` unless every action is (the tool description then says so once).
 * `run` is replaceable in tests.
 */
export function domainActions(domain: Domain, run: typeof runOperation = runOperation): ActionMap {
  const ops = exposed(domain);
  const markUndocumented = !allUndocumented(ops);
  const actions: Record<string, ActionMap[string]> = {};
  for (const op of ops) {
    actions[op.name] = {
      summary: actionSummary(op, markUndocumented),
      shape: op.input,
      handler: async (args) => jsonContent(await run(op, args)),
    };
  }
  return actions;
}

/** Register the domain's tool. Read-only when every exposed operation reads; destructive when any is. */
export function registerDomainTool(server: McpServer, domain: Domain): void {
  const ops = exposed(domain);
  const description = allUndocumented(ops) ? `${domain.summary} ${ALL_UNDOCUMENTED}` : domain.summary;
  actionTool(server, domain.tool, description, domainActions(domain), {
    readOnlyHint: ops.every((op) => op.impact === "read"),
    destructiveHint: ops.some((op) => op.impact === "destructive" || op.escalate?.impact === "destructive"),
  });
}
