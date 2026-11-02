/**
 * @module mcp/action-tool
 * One MCP tool per domain that dispatches over an `action` field, instead of one tool per
 * operation. Every tool definition costs context in every client session, so a few tools with
 * an action list keep the surface small.
 *
 * MCP needs an object at the top of every input schema, so the tool schema is flat: a required
 * `action` enum, an optional `profile`, and the union of every action's fields, all optional.
 * Per-action requiredness comes back at call time: the arguments are checked against the chosen
 * action's own schema, unknown fields rejected rather than dropped.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withProfile } from "../context.js";
import { toLibreDeskError } from "../errors.js";
import { maskSecrets } from "../mask.js";

/**
 * MCP text-content tool result. A `type` rather than an `interface` so it carries the implicit
 * index signature the SDK's `CallToolResult` requires.
 */
export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/** One operation exposed by an action-dispatch tool. */
export interface ActionDef {
  /** One line, listed under the tool description. */
  readonly summary: string;
  /** Fields of this action, without the shared `action` and `profile` fields. */
  readonly shape: z.ZodRawShape;
  /** Called with the arguments validated against {@link ActionDef.shape}. */
  readonly handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

/** Map of action name to definition. */
export type ActionMap = Readonly<Record<string, ActionDef>>;

/** Hints MCP clients use to decide whether to ask before a call. */
export interface ActionToolAnnotations {
  readonly destructiveHint?: boolean;
  readonly readOnlyHint?: boolean;
}

/** Description of the `profile` field every tool accepts. */
export const PROFILE_FIELD = z
  .string()
  .optional()
  .describe("Stored profile to use; omit for the default.");

function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** Convert any thrown value into an error result: the message plus a `Hint:` line, never a stack or cause. */
export function toolErrorResult(err: unknown): ToolResult {
  const error = toLibreDeskError(err);
  return errorResult(error.hint ? `${error.message}\nHint: ${error.hint}` : error.message);
}

/** A success result holding `data` as compact JSON, secrets masked. */
export function jsonContent(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(maskSecrets(data)) ?? "null" }] };
}

function issueText(issues: readonly z.core.$ZodIssue[]): string {
  return issues
    .flatMap((issue) => {
      if (issue.code === "unrecognized_keys") return issue.keys.map((key) => `${key}: not a field of this action`);
      const label = issue.path.length > 0 ? issue.path.map(String).join(".") : "(input)";
      return [`${label}: ${issue.message}`];
    })
    .join("; ");
}

/**
 * Check `args` against the chosen action's schema and run its handler under the `profile`
 * argument. Unknown actions, invalid input and thrown errors come back as error results.
 */
export async function dispatchAction(actions: ActionMap, args: Record<string, unknown>): Promise<ToolResult> {
  const { action, profile, ...rest } = args;
  if (typeof action !== "string" || !Object.hasOwn(actions, action)) {
    return errorResult(`Unknown action "${String(action)}". Valid actions: ${Object.keys(actions).join(", ")}.`);
  }
  if (profile !== undefined && typeof profile !== "string") return errorResult("profile: expected a profile name");
  const def = actions[action] as ActionDef;
  const parsed = z.object(def.shape).strict().safeParse(rest);
  if (!parsed.success) {
    const fields = Object.keys(def.shape).join(", ") || "(none)";
    return errorResult(`Invalid input for action "${action}": ${issueText(parsed.error.issues)}\nHint: Fields of ${action}: ${fields}.`);
  }
  try {
    return await withProfile(profile || undefined, () => def.handler(parsed.data));
  } catch (error) {
    return toolErrorResult(error);
  }
}

type Schema = z.core.$ZodType;

/** The schema without its outer optional and default wrappers; nullable stays. */
function withoutDefault(schema: Schema): z.ZodType {
  let current = schema;
  for (;;) {
    const def = current._zod.def;
    if (def.type !== "optional" && def.type !== "default" && def.type !== "prefault") return current as z.ZodType;
    current = (def as z.core.$ZodOptionalDef).innerType;
  }
}

function descriptionOf(schema: Schema): string {
  let current: Schema | undefined = schema;
  while (current !== undefined) {
    const description = z.globalRegistry.get(current)?.description;
    if (description) return description;
    const def = current._zod.def as { innerType?: Schema };
    current = def.innerType;
  }
  return "";
}

/**
 * One description for a field several actions share. When the actions describe it differently,
 * the most common description comes first and the others are named by action.
 */
function mergedDescription(uses: readonly { readonly action: string; readonly description: string }[]): string {
  const groups = new Map<string, string[]>();
  for (const { action, description } of uses) groups.set(description, [...(groups.get(description) ?? []), action]);
  const [first, ...others] = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  if (first === undefined) return "";
  return [first[0], ...others.map(([description, names]) => `For ${names.join(", ")}: ${description}`)].filter(Boolean).join(" ");
}

/**
 * Merge every action's fields into one flat shape, each optional and without its default (a
 * default would be filled in for actions that do not have the field). A field several actions
 * share keeps the first action's schema; per-action validation still uses each action's own.
 */
export function mergeShapes(actions: ActionMap): z.ZodRawShape {
  const fields = new Map<string, { schema: Schema; uses: { action: string; description: string }[] }>();
  for (const [action, def] of Object.entries(actions)) {
    for (const [key, schema] of Object.entries(def.shape)) {
      const entry = fields.get(key) ?? { schema, uses: [] };
      fields.set(key, { ...entry, uses: [...entry.uses, { action, description: descriptionOf(schema) }] });
    }
  }
  return Object.fromEntries(
    [...fields].map(([key, { schema, uses }]) => {
      const description = mergedDescription(uses);
      const optional = withoutDefault(schema).optional();
      return [key, description ? optional.describe(description) : optional];
    }),
  );
}

function isRequired(schema: Schema): boolean {
  const type = schema._zod.def.type;
  return type !== "optional" && type !== "default" && type !== "prefault";
}

/** The tool description: the domain summary, then one line per action with its required fields (`...` when it has optional ones). */
export function buildDescription(base: string, actions: ActionMap): string {
  const lines = Object.entries(actions).map(([name, def]) => {
    const schemas = Object.entries(def.shape);
    const required = schemas.filter(([, schema]) => isRequired(schema)).map(([key]) => key);
    const fields = required.length < schemas.length ? [...required, "..."] : required;
    return `- ${name}(${fields.join(", ")}): ${def.summary}`;
  });
  return `${base}\n\nActions:\n${lines.join("\n")}`;
}

/** The full input shape of an action tool: `action`, the merged action fields and `profile`. */
export function actionToolShape(actions: ActionMap): z.ZodRawShape {
  const names = Object.keys(actions);
  return {
    action: z.enum(names as [string, ...string[]]).describe("Action."),
    ...mergeShapes(actions),
    profile: PROFILE_FIELD,
  };
}

/**
 * Register a tool that dispatches over an `action` field.
 *
 * @param server - Server to register on.
 * @param name - Tool name, `libredesk_*`.
 * @param description - Domain summary; the action list is appended.
 * @param actions - The actions.
 * @param annotations - Read-only and destructive hints for the client.
 */
export function actionTool(
  server: McpServer,
  name: string,
  description: string,
  actions: ActionMap,
  annotations: ActionToolAnnotations = {},
): void {
  if (Object.keys(actions).length === 0) throw new Error(`actionTool("${name}") needs at least one action`);
  server.registerTool(
    name,
    // Loose, so a misspelt field reaches dispatchAction and is reported instead of silently dropped.
    { description: buildDescription(description, actions), inputSchema: z.looseObject(actionToolShape(actions)), annotations },
    async (input: Record<string, unknown>) => dispatchAction(actions, input),
  );
}
