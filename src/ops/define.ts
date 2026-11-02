/**
 * @module ops/define
 * Declarative description of LibreDesk endpoints. Each endpoint is declared once as an
 * {@link Operation}; the CLI, the interactive prompts, the MCP tools and the catalog are all
 * generated from these declarations. Definitions are checked when the module loads.
 */

import type { z } from "zod";
import type { Profile } from "../config.js";
import type { HttpMethod, RequestOptions } from "../http.js";

/** How much an operation changes on the server. `caution` and `destructive` need confirmation. */
export type Impact = "read" | "write" | "caution" | "destructive";

/** MCP toolset a domain belongs to, selectable through `LIBREDESK_TOOLSETS`. */
export type Toolset = "knowledge" | "ai" | "workflow" | "support" | "core";

/** What a custom {@link Operation.run} receives besides its input. */
export interface OperationContext {
  /** The profile the operation runs against. */
  readonly profile: Profile;
  /** Send a request with the bound profile; the response envelope is unwrapped. */
  readonly call: <T = unknown>(method: HttpMethod, path: string, opts?: Omit<RequestOptions, "fetchImpl">) => Promise<T>;
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
  /** Custom implementation replacing the default single request. */
  readonly run?: Callback<[input: z.infer<z.ZodObject<S>>, ctx: OperationContext], Promise<unknown>>;
  /** Transforms the response before it is returned. */
  readonly present?: Callback<[data: unknown, input: z.infer<z.ZodObject<S>>], unknown>;
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
  /** The domain's operations. */
  readonly operations: readonly Operation[];
}

const PATH_PARAM = /\{([^{}]+)\}/g;

/** Names of the `{param}` placeholders in a path template, in order. */
export function pathParams(path: string): string[] {
  return [...path.matchAll(PATH_PARAM)].map((m) => m[1] ?? "");
}

function assertInputKeys(name: string, input: z.ZodRawShape, what: string, keys: readonly string[] | undefined): void {
  for (const key of keys ?? []) {
    if (!Object.hasOwn(input, key)) throw new Error(`${name}: ${what} field ${key} is not an input field`);
  }
}

/** Check an operation definition and return it unchanged. Throws on an inconsistent definition. */
export function defineOperation<S extends z.ZodRawShape>(op: Operation<S>): Operation<S> {
  for (const param of pathParams(op.path)) {
    if (!Object.hasOwn(op.input, param)) throw new Error(`${op.name}: path param {${param}} is not an input field`);
  }
  assertInputKeys(op.name, op.input, "query", op.query);
  assertInputKeys(op.name, op.input, "positional", op.positional);
  if ((op.impact === "caution" || op.impact === "destructive") && !op.effect) {
    throw new Error(`${op.name}: ${op.impact} operations need an effect`);
  }
  if (op.group !== undefined && !op.name.startsWith(`${op.group}_`)) {
    throw new Error(`${op.name}: operations in group ${op.group} must be named ${op.group}_*`);
  }
  return op;
}

/** Check a domain definition and return it unchanged. Throws on duplicate operation names. */
export function defineDomain(domain: Domain): Domain {
  const seen = new Set<string>();
  for (const op of domain.operations) {
    if (seen.has(op.name)) throw new Error(`${domain.name}: duplicate operation ${op.name}`);
    seen.add(op.name);
  }
  return domain;
}
