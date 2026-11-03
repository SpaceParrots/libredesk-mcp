/**
 * @module ops/define
 * Declarative description of LibreDesk endpoints. Each endpoint is declared once as an
 * {@link Operation}; the CLI, the interactive prompts, the MCP tools and the catalog are all
 * generated from these declarations. Definitions are checked when the module loads.
 */

import type { z } from "zod";
import type { Profile } from "../config.js";
import type { HttpMethod, RequestOptions } from "../http.js";
import { fieldInfo } from "./fields.js";

/** How much an operation changes on the server. `caution` and `destructive` need confirmation. */
export type Impact = "read" | "write" | "caution" | "destructive";

/**
 * Shared MCP tool that holds the risky actions of every domain, so a client can allowlist the
 * domain tools while publishing and deleting still ask: `publish` for changes to what customers
 * and assistants see, `delete` for deletes.
 */
export type RiskTool = "publish" | "delete";

/** MCP toolset a domain belongs to, selectable through `LIBREDESK_TOOLSETS`. */
export type Toolset = "knowledge" | "ai" | "workflow" | "support" | "core";

/** What a custom {@link Operation.run} receives besides its input. */
export interface OperationContext {
  /** The profile the operation runs against. */
  readonly profile: Profile;
  /** Send a request with the bound profile; the response envelope is unwrapped. */
  readonly call: <T = unknown>(method: HttpMethod, path: string, opts?: Omit<RequestOptions, "fetchImpl">) => Promise<T>;
  /**
   * Who started the operation. An MCP call comes from a model whose arguments content it read can
   * steer, so operations that touch the local machine restrict themselves for `mcp`.
   */
  readonly caller: "cli" | "mcp";
}

/**
 * A callback type checked bivariantly in its parameters (method-signature semantics), so an
 * `Operation<S>` with a typed `run` or `present` stays assignable to the plain `Operation`.
 */
type Callback<A extends unknown[], R> = { bivarianceHack(...args: A): R }["bivarianceHack"];

/**
 * An input field name of shape `S`. Same keys as `keyof S & string`, but written through
 * `z.infer` so TypeScript compares it structurally: a bare `keyof S` would make `S` invariant and
 * an `Operation<{ id: ... }>` would no longer fit in `Domain.operations`.
 */
export type FieldName<S extends z.ZodRawShape> = keyof z.infer<z.ZodObject<S>> & string;

/**
 * Help text only the CLI shows. The MCP tool definitions never include it, so it costs no model
 * context: put examples and explanations an agent reading `--help` needs here, not in `summary`.
 */
export interface CliHelp<S extends z.ZodRawShape = z.ZodRawShape> {
  /** Full command lines starting with `ldesk `, shown under "Examples:". */
  readonly examples?: readonly string[];
  /** Short paragraphs shown under "Notes:", such as what a list prints or where an id comes from. */
  readonly notes?: readonly string[];
  /** Optional fields left out of the help; their flags are still accepted. */
  readonly hidden?: readonly FieldName<S>[];
  /**
   * Help text of a boolean field's `--<field>` (`on`) and `--no-<field>` (`off`) flags, for fields
   * whose description reads wrong as either; by default `on` is the description and `off` is
   * "Do not" plus its first sentence.
   */
  readonly flags?: Readonly<Partial<Record<FieldName<S>, BooleanFlagText>>>;
}

/** Help text of the two flags of a boolean field. */
export interface BooleanFlagText {
  /** Text of `--<field>`. */
  readonly on?: string;
  /** Text of `--no-<field>`. */
  readonly off?: string;
}

/**
 * A higher impact for some inputs only: `articles create` with `status: "published"` needs the
 * same confirmation as `set_status`. `when` sees the values the caller passed, before defaults.
 */
export interface Escalation {
  /** True when the passed values make the operation riskier. */
  readonly when: (values: Readonly<Record<string, unknown>>) => boolean;
  /** Plain words for `when`, such as "status is published"; shown in help and the MCP action list. */
  readonly condition: string;
  /** The impact that applies when `when` is true. */
  readonly impact: "caution" | "destructive";
  /** What happens then, shown before confirming. */
  readonly effect: string;
  /**
   * Optional input fields that alone make `when` true. The MCP domain tool leaves them out, so it
   * can never take the riskier path; that path is an action of a {@link RiskTool}.
   */
  readonly fields?: readonly string[];
}

/** One LibreDesk endpoint (or a composite of several), declared once. */
export interface Operation<S extends z.ZodRawShape = z.ZodRawShape> {
  /** snake_case, unique per domain; the MCP action name. */
  readonly name: string;
  /** CLI sub-group; `name` must start with `${group}_`. */
  readonly group?: string;
  /** One line, shown in --help, the MCP action list and the catalog. */
  readonly summary: string;
  /** HTTP method of the default request. */
  readonly method: HttpMethod;
  /** Path template such as "/api/v1/help-centers/{id}"; every `{param}` must be a key of `input`. */
  readonly path: string;
  /** Input fields. */
  readonly input: S;
  /** Input fields sent as query parameters. */
  readonly query?: readonly FieldName<S>[];
  /** How much the operation changes. */
  readonly impact: Impact;
  /** What happens, shown before confirming; required when impact is caution or destructive. */
  readonly effect?: string;
  /** Role permission the endpoint needs, e.g. "help_center:manage"; added to PermissionError hints. */
  readonly permission?: string;
  /** True when built from the LibreDesk source rather than the documented OpenAPI spec. */
  readonly undocumented?: boolean;
  /** Input fields taken as CLI positional arguments, in order. */
  readonly positional?: readonly FieldName<S>[];
  /** Whether the operation is exposed over MCP. Defaults to true. */
  readonly mcp?: boolean;
  /** Shared MCP tool for the operation; defaults to `publish` for caution and `delete` for destructive. */
  readonly mcpTool?: RiskTool;
  /** Custom implementation replacing the default single request. */
  readonly run?: Callback<[input: z.infer<z.ZodObject<S>>, ctx: OperationContext], Promise<unknown>>;
  /** Transforms the response before it is returned. */
  readonly present?: Callback<[data: unknown, input: z.infer<z.ZodObject<S>>], unknown>;
  /** Help text only the CLI shows. */
  readonly cli?: CliHelp<S>;
  /** A higher impact for some inputs, confirmed like a `caution` or `destructive` operation. */
  readonly escalate?: Escalation;
}

/** A group of operations: one CLI command and one MCP tool. */
export interface Domain {
  /** CLI command, kebab-case. */
  readonly name: string;
  /** MCP tool name, `libredesk_*`. */
  readonly tool: string;
  /** Toolset the MCP tool belongs to. */
  readonly toolset: Toolset;
  /** One line describing the domain. */
  readonly summary: string;
  /** Prefix of ungrouped action names in a shared {@link RiskTool}, e.g. `article` for `article_delete`. */
  readonly actionPrefix: string;
  /** CLI description of each operation group, keyed by group name; every group needs one. */
  readonly groups?: Readonly<Record<string, string>>;
  /** The domain's operations. */
  readonly operations: readonly Operation[];
}

const PATH_PARAM = /\{([^{}]+)\}/g;

/** Names of the `{param}` placeholders in a path template, in order. */
export function pathParams(path: string): string[] {
  return [...path.matchAll(PATH_PARAM)].map((m) => m[1] ?? "");
}

/** Replace every `{param}` placeholder in a path template with `value(param)`. */
export function fillPath(path: string, value: (param: string) => string): string {
  return path.replace(PATH_PARAM, (_match, param: string) => value(param));
}

/** Input field names the generated CLI flags and the MCP action tool use themselves. */
export const RESERVED_FIELD_NAMES: ReadonlySet<string> = new Set(["action", "profile", "json", "yes"]);

function assertInputKeys(name: string, input: z.ZodRawShape, what: string, keys: readonly string[] | undefined): void {
  for (const key of keys ?? []) {
    if (!Object.hasOwn(input, key)) throw new Error(`${name}: ${what} field ${key} is not an input field`);
  }
}

function assertPathParams(op: Operation): void {
  for (const param of pathParams(op.path)) {
    const schema = Object.hasOwn(op.input, param) ? op.input[param] : undefined;
    if (schema === undefined) throw new Error(`${op.name}: path param {${param}} is not an input field`);
    const info = fieldInfo(param, schema);
    if (!info.required && !("defaultValue" in info)) {
      throw new Error(`${op.name}: path param {${param}} must not be optional (give it a default instead)`);
    }
  }
}

/** A GET or DELETE without a custom `run` has no body, so every field must reach the path or the query. */
function assertNoBodyFields(op: Operation): void {
  if (op.run !== undefined || (op.method !== "GET" && op.method !== "DELETE")) return;
  const sent = new Set<string>([...pathParams(op.path), ...(op.query ?? [])]);
  for (const key of Object.keys(op.input)) {
    if (!sent.has(key)) throw new Error(`${op.name}: ${op.method} field ${key} is neither a path param nor a query field`);
  }
}

const IMPACT_RANK: Readonly<Record<Impact, number>> = { read: 0, write: 1, caution: 2, destructive: 3 };

function assertCliHelp(op: Operation): void {
  const cli = op.cli;
  if (cli === undefined) return;
  for (const key of cli.hidden ?? []) {
    const schema = Object.hasOwn(op.input, key) ? op.input[key] : undefined;
    if (schema === undefined) throw new Error(`${op.name}: hidden field ${key} is not an input field`);
    if (fieldInfo(key, schema).required) throw new Error(`${op.name}: hidden field ${key} is required`);
  }
  assertInputKeys(op.name, op.input, "flag text", Object.keys(cli.flags ?? {}));
  for (const example of cli.examples ?? []) {
    if (!example.startsWith("ldesk ")) throw new Error(`${op.name}: example "${example}" must start with "ldesk "`);
  }
}

function assertEscalation(op: Operation): void {
  const escalate = op.escalate;
  if (escalate === undefined) return;
  if (!escalate.effect) throw new Error(`${op.name}: escalate needs an effect`);
  if (!escalate.condition) throw new Error(`${op.name}: escalate needs a condition`);
  if (IMPACT_RANK[escalate.impact] <= IMPACT_RANK[op.impact]) throw new Error(`${op.name}: escalate must raise the impact`);
  for (const key of escalate.fields ?? []) {
    const schema = Object.hasOwn(op.input, key) ? op.input[key] : undefined;
    if (schema === undefined) throw new Error(`${op.name}: escalate field ${key} is not an input field`);
    if (fieldInfo(key, schema).required) throw new Error(`${op.name}: escalate field ${key} must be optional`);
  }
}

/** The shared MCP tool an operation belongs in, or undefined when it stays in its domain tool. */
export function riskToolOf(op: Operation): RiskTool | undefined {
  if (op.mcpTool !== undefined) return op.mcpTool;
  if (op.impact === "destructive") return "delete";
  return op.impact === "caution" ? "publish" : undefined;
}

/** The action name of an operation in a shared {@link RiskTool}: grouped names stay, others get the domain prefix. */
export function riskActionName(domain: Domain, op: Operation): string {
  return op.group === undefined ? `${domain.actionPrefix}_${op.name}` : op.name;
}

/** Check an operation definition and return it unchanged. Throws on an inconsistent definition. */
export function defineOperation<S extends z.ZodRawShape>(op: Operation<S>): Operation<S> {
  for (const key of Object.keys(op.input)) {
    if (RESERVED_FIELD_NAMES.has(key)) throw new Error(`${op.name}: input field ${key} is reserved`);
  }
  assertPathParams(op);
  assertInputKeys(op.name, op.input, "query", op.query);
  assertInputKeys(op.name, op.input, "positional", op.positional);
  assertNoBodyFields(op);
  if ((op.impact === "caution" || op.impact === "destructive") && !op.effect) {
    throw new Error(`${op.name}: ${op.impact} operations need an effect`);
  }
  if (op.group !== undefined && !op.name.startsWith(`${op.group}_`)) {
    throw new Error(`${op.name}: operations in group ${op.group} must be named ${op.group}_*`);
  }
  assertCliHelp(op);
  assertEscalation(op);
  return op;
}

/** Check a domain definition and return it unchanged. Throws on duplicate operation names and undescribed groups. */
export function defineDomain(domain: Domain): Domain {
  const seen = new Set<string>();
  for (const op of domain.operations) {
    if (seen.has(op.name)) throw new Error(`${domain.name}: duplicate operation ${op.name}`);
    seen.add(op.name);
    if (op.group !== undefined && !domain.groups?.[op.group]) {
      throw new Error(`${domain.name}: group ${op.group} needs a description in groups`);
    }
  }
  return domain;
}
