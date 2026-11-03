/**
 * @module ops/run
 * Executes an {@link Operation}: validate the raw input, resolve the profile, send the request
 * (or call the operation's own `run`), then apply `present`.
 */

import { z } from "zod";
import type { Profile } from "../config.js";
import { getCurrentProfile } from "../context.js";
import { InputError, PermissionError } from "../errors.js";
import { request, type QueryValue } from "../http.js";
import { fillPath, pathParams, type Operation, type OperationContext } from "./define.js";

/** An operation's input split into the request parts. */
export interface SplitInput {
  /** Path with every `{param}` replaced by its URL-encoded value. */
  readonly path: string;
  /** Query parameters. */
  readonly query: Record<string, QueryValue>;
  /** JSON body, or undefined for GET, DELETE and when no body field is set. */
  readonly body: Record<string, unknown> | undefined;
}

/** Optional dependencies of {@link runOperation}. */
export interface RunDeps {
  /** Profile to use instead of the current one. */
  readonly profile?: Profile;
  /** Replacement for the global `fetch`, used by tests. */
  readonly fetchImpl?: typeof fetch;
  /** Who started the operation; defaults to the CLI. */
  readonly caller?: OperationContext["caller"];
}

function toQueryValue(value: unknown): QueryValue {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return JSON.stringify(value);
}

/** Split validated input into path, query and body. Keys whose value is `undefined` are left out. */
export function splitInput(op: Operation, input: Record<string, unknown>): SplitInput {
  const params = new Set(pathParams(op.path));
  const queryKeys = new Set<string>(op.query ?? []);
  const path = fillPath(op.path, (name) => {
    const value = input[name];
    if (value === undefined || value === null) {
      throw new InputError(`${op.name}: missing path parameter ${name}`, { fields: [name] });
    }
    return encodeURIComponent(String(value));
  });
  const query: Record<string, QueryValue> = {};
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || params.has(key)) continue;
    if (queryKeys.has(key)) {
      if (value !== null) query[key] = toQueryValue(value);
    } else {
      body[key] = value;
    }
  }
  const sendsBody = op.method !== "GET" && op.method !== "DELETE" && Object.keys(body).length > 0;
  return { path, query, body: sendsBody ? body : undefined };
}

function issueLines(issues: readonly z.core.$ZodIssue[]): { lines: string[]; fields: string[] } {
  const lines: string[] = [];
  const fields: string[] = [];
  for (const issue of issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        lines.push(`${[...issue.path, key].map(String).join(".")}: unknown field`);
        fields.push(String(issue.path[0] ?? key));
      }
      continue;
    }
    const label = issue.path.length > 0 ? issue.path.map(String).join(".") : "(input)";
    lines.push(`${label}: ${issue.message}`);
    if (issue.path.length > 0) fields.push(String(issue.path[0]));
  }
  return { lines, fields: [...new Set(fields)] };
}

/** Validate raw input against the operation's fields (unknown fields rejected, defaults applied). */
export function validateInput(op: Operation, raw: unknown): Record<string, unknown> {
  const result = z.object(op.input).strict().safeParse(raw ?? {});
  if (result.success) return result.data;
  const { lines, fields } = issueLines(result.error.issues);
  throw new InputError(`Invalid input for ${op.name}: ${lines.join("; ")}`, {
    fields,
    hint: `Fields of ${op.name}: ${Object.keys(op.input).join(", ") || "(none)"}.`,
  });
}

function withPermission(op: Operation, error: unknown): unknown {
  if (!(error instanceof PermissionError) || op.permission === undefined) return error;
  return new PermissionError(error.message, {
    status: error.status,
    errorType: error.errorType,
    data: error.data,
    permission: op.permission,
    hint: `This needs the \`${op.permission}\` permission on the agent's role.`,
    cause: error,
  });
}

/** Validate the input, run the operation against the resolved profile and present the result. */
export async function runOperation(op: Operation, raw: unknown, deps: RunDeps = {}): Promise<unknown> {
  const input = validateInput(op, raw);
  const profile = deps.profile ?? (await getCurrentProfile()).profile;
  const ctx: OperationContext = {
    profile,
    call: (method, path, opts = {}) => request(profile, method, path, { ...opts, fetchImpl: deps.fetchImpl }),
    caller: deps.caller ?? "cli",
  };
  let data: unknown;
  try {
    if (op.run) {
      data = await op.run(input, ctx);
    } else {
      const { path, query, body } = splitInput(op, input);
      data = await ctx.call(op.method, path, { query, body });
    }
  } catch (error) {
    throw withPermission(op, error);
  }
  return op.present ? op.present(data, input) : data;
}
