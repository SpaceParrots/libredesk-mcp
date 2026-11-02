/**
 * @module cli/flags
 * Turns an operation's input fields into command line flags and the parsed flag values back
 * into operation input.
 */

import { readFileSync } from "node:fs";
import { InputError } from "../errors.js";
import type { Operation } from "../ops/define.js";
import { operationFields, type FieldInfo, type FieldKind } from "../ops/fields.js";

/** One command line flag of an operation. */
export interface FlagSpec {
  /** Input field the flag fills. */
  readonly field: string;
  /** Commander flag string, e.g. `--collection-id <value>` or `--no-ai-enabled`. */
  readonly flags: string;
  /** Help text. */
  readonly description: string;
  /** How the value is entered. For arrays, the kind of each element. */
  readonly kind: FieldKind;
  /** True when the operation cannot run without it. */
  readonly required: boolean;
  /** Allowed values of an enum field. */
  readonly choices?: readonly string[];
  /** True for a repeatable flag that collects its values. */
  readonly array: boolean;
}

/** `ai_enabled` becomes `ai-enabled`. */
export function kebab(name: string): string {
  return name.replaceAll("_", "-");
}

/** The key commander stores a flag's value under: `ai_enabled` becomes `aiEnabled`. */
export function optionKey(field: string): string {
  return kebab(field)
    .split("-")
    .reduce((out, word) => out + (word === "" ? "" : word.charAt(0).toUpperCase() + word.slice(1)));
}

function describe(info: FieldInfo): string {
  const parts = [info.description];
  if (info.required) parts.push("(required)");
  if (info.defaultValue !== undefined) parts.push(`(default: ${String(info.defaultValue)})`);
  if (info.array) parts.push("(repeatable)");
  return parts.filter((part) => part !== "").join(" ");
}

function specsFor(info: FieldInfo): FlagSpec[] {
  const flag = `--${kebab(info.name)}`;
  const base = {
    field: info.name,
    description: describe(info),
    kind: info.kind,
    required: info.required,
    array: info.array,
    ...(info.enumValues !== undefined ? { choices: info.enumValues } : {}),
  };
  if (info.kind === "boolean" && !info.array) {
    const positive: FlagSpec = { ...base, flags: flag };
    const negative: FlagSpec = { ...base, flags: `--no-${kebab(info.name)}` };
    if (info.defaultValue === true) return [negative];
    return info.defaultValue === undefined ? [positive, negative] : [positive];
  }
  return [{ ...base, flags: `${flag} <value>` }];
}

/**
 * Flags of an operation, in field order. Positional fields are not flags. Booleans get `--x`
 * and `--no-x`; a boolean that defaults to true only needs `--no-x`.
 */
export function flagsFor(op: Operation): FlagSpec[] {
  const positional = new Set<string>(op.positional ?? []);
  return operationFields(op)
    .filter((info) => !positional.has(info.name))
    .flatMap(specsFor);
}

function invalid(op: Operation, field: string, what: string): InputError {
  return new InputError(`Invalid value for --${kebab(field)}: ${what}.`, {
    fields: [field],
    hint: `Fields of ${op.name}: ${Object.keys(op.input).join(", ")}.`,
  });
}

function readFileValue(op: Operation, field: string, raw: string, readFile: (path: string) => string): string {
  if (!raw.startsWith("@")) return raw;
  if (raw.startsWith("@@")) return raw.slice(1);
  const path = raw.slice(1);
  try {
    return readFile(path);
  } catch {
    throw invalid(op, field, `cannot read the file ${path}`);
  }
}

function coerce(op: Operation, info: FieldInfo, raw: unknown, readFile: (path: string) => string): unknown {
  if (info.kind === "boolean") {
    if (typeof raw === "boolean") return raw;
    throw invalid(op, info.name, "expected true or false");
  }
  if (typeof raw !== "string") return raw;
  if (info.kind === "number") {
    const number = raw.trim() === "" ? Number.NaN : Number(raw);
    if (Number.isNaN(number)) throw invalid(op, info.name, "expected a number");
    return number;
  }
  if (info.kind === "enum") return raw;
  const text = readFileValue(op, info.name, raw, readFile);
  if (info.kind === "string") return text;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw invalid(op, info.name, "expected valid JSON");
  }
}

/**
 * Convert parsed commander options and positional arguments into operation input. Only values
 * the user passed appear in the result, so omitted fields stay `undefined` and the server keeps
 * their current value. Numbers are parsed, `json` fields are parsed as JSON, and a string or json
 * value starting with `@` is read from that file (`@@` stands for a literal `@`).
 */
export function parseFlagValues(
  op: Operation,
  options: Record<string, unknown>,
  positionals: readonly string[],
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): Record<string, unknown> {
  const fields = new Map(operationFields(op).map((info) => [info.name, info]));
  const positional = op.positional ?? [];
  const values: Record<string, unknown> = {};
  const set = (info: FieldInfo, raw: unknown) => {
    if (raw === undefined) return;
    if (Array.isArray(raw)) values[info.name] = raw.map((item) => coerce(op, info, item, readFile));
    else values[info.name] = info.array ? [coerce(op, info, raw, readFile)] : coerce(op, info, raw, readFile);
  };
  positional.forEach((name, index) => {
    const info = fields.get(name);
    if (info) set(info, positionals[index] ?? options[optionKey(name)]);
  });
  for (const info of fields.values()) {
    if (!positional.includes(info.name)) set(info, options[optionKey(info.name)]);
  }
  return values;
}
