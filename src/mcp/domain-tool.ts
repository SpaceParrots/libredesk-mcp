/**
 * @module mcp/domain-tool
 * Turns a {@link Domain} into one action-dispatch MCP tool: one action per operation, run through
 * {@link runOperation}. Publishing and deleting are left out; they are actions of the shared
 * `libredesk_publish` and `libredesk_delete` tools (see `mcp/risk-tools`), so a client can allow
 * the domain tools once and still be asked before anything goes public or away.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import { riskToolOf, type Domain, type Impact, type Operation } from "../ops/define.js";
import { runOperation } from "../ops/run.js";
import { actionTool, jsonContent, type ActionMap } from "./action-tool.js";

/** Appended to the tool description when every action of the domain is undocumented. */
export const ALL_UNDOCUMENTED = "Undocumented API.";

function riskLabel(impact: Impact): string | undefined {
  if (impact === "destructive") return "DESTRUCTIVE";
  return impact === "caution" ? "CAUTION" : undefined;
}

/** Name of the shared MCP tool for a risk tier. */
export function riskToolName(tool: "publish" | "delete"): string {
  return `libredesk_${tool}`;
}

function escalationText(op: Operation): string {
  const escalate = op.escalate;
  if (escalate === undefined) return "";
  // The domain tool leaves these fields out, so the escalation cannot happen there; the server
  // instructions say where publishing lives.
  if (escalate.fields !== undefined && escalate.fields.length > 0) return "";
  return ` ${riskLabel(escalate.impact) ?? ""} when ${escalate.condition}: ${escalate.effect}`;
}

/**
 * The action summary: the operation summary, plus ` [undocumented]` when asked, plus the caution
 * or destructive effect, plus an escalation as `CAUTION when <condition>: <effect>` unless the
 * escalating fields are left out of the tool.
 */
export function actionSummary(op: Operation, markUndocumented = true): string {
  const undocumented = markUndocumented && op.undocumented ? " [undocumented]" : "";
  const label = riskLabel(op.impact);
  const risk = label === undefined ? "" : ` ${label}: ${op.effect ?? ""}`;
  return `${op.summary}${undocumented}${risk}${escalationText(op)}`;
}

/** The input fields the domain tool offers: all but the escalating ones. */
export function domainToolShape(op: Operation): z.ZodRawShape {
  const left = new Set(op.escalate?.fields ?? []);
  return Object.fromEntries(Object.entries(op.input).filter(([key]) => !left.has(key)));
}

function exposed(domain: Domain): Operation[] {
  return domain.operations.filter((op) => op.mcp !== false && riskToolOf(op) === undefined);
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
      shape: domainToolShape(op),
      handler: async (args) => jsonContent(await run(op, args, { caller: "mcp" })),
    };
  }
  return actions;
}

/**
 * Register the domain's tool, unless every operation went to a shared tool. Read-only when every
 * exposed operation reads; never destructive, since deletes are in `libredesk_delete`.
 */
export function registerDomainTool(server: McpServer, domain: Domain): void {
  const ops = exposed(domain);
  if (ops.length === 0) return;
  const description = allUndocumented(ops) ? `${domain.summary} ${ALL_UNDOCUMENTED}` : domain.summary;
  actionTool(server, domain.tool, description, domainActions(domain), {
    readOnlyHint: ops.every((op) => op.impact === "read"),
    destructiveHint: false,
  });
}
