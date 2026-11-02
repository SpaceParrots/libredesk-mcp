/**
 * @module cli/flags
 * Turns an operation's input fields into command line flags and the parsed flag values back
 * into operation input.
 */

import { readFileSync } from "node:fs";
import { InputError } from "../errors.js";
import type { BooleanFlagText, Operation } from "../ops/define.js";
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
  /** True when the help leaves the flag out (`cli.hidden`); it is still accepted. */
  readonly hidden: boolean;
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

function joined(...parts: readonly string[]): string {
  return parts.filter((part) => part !== "").join(" ");
}

function describe(info: FieldInfo): string {
  return joined(
    info.description,
    info.nullable ? "Pass null to clear it." : "",
    info.required ? "(required)" : "",
    info.defaultValue !== undefined && !info.description.includes("(default)") ? `(default: ${String(info.defaultValue)})` : "",
    info.array ? "(repeatable)" : "",
  );
}

/** "Do not" plus the first sentence of `description`: "Let AI answer. On by default." gives "Do not let AI answer.". */
function negated(info: FieldInfo): string {
  if (info.description === "") return `Turn ${kebab(info.name)} off.`;
  const first = info.description.split(/(?<=\.)\s/)[0] ?? info.description;
  return `Do not ${first.charAt(0).toLowerCase()}${first.slice(1)}`;
}

/**
 * The flags of a boolean field: the one a user actually passes. Default true shows `--no-x`,
 * default false shows `--x`, and no default (updates, filters, required switches) shows both.
 */
function booleanSpecs(info: FieldInfo, base: Omit<FlagSpec, "flags" | "description">, text: BooleanFlagText): FlagSpec[] {
  const name = kebab(info.name);
  const on = text.on ?? info.description;
  const off = text.off ?? negated(info);
  if (info.defaultValue === true) return [{ ...base, flags: `--no-${name}`, description: joined(off, `(${name} is on by default)`) }];
  if (info.defaultValue === false) return [{ ...base, flags: `--${name}`, description: joined(on, "(off by default)") }];
  const required = info.required ? `(this or --no-${name} is required)` : "";
  return [
    { ...base, flags: `--${name}`, description: joined(on, required) },
    { ...base, flags: `--no-${name}`, description: off },
  ];
}

function specsFor(info: FieldInfo, op: Operation, hidden: boolean): FlagSpec[] {
  const base = {
    field: info.name,
    kind: info.kind,
    required: info.required,
    array: info.array,
    hidden,
    ...(info.enumValues !== undefined ? { choices: info.enumValues } : {}),
  };
  if (info.kind === "boolean" && !info.array) return booleanSpecs(info, base, op.cli?.flags?.[info.name] ?? {});
  return [{ ...base, flags: `--${kebab(info.name)} <value>`, description: describe(info) }];
}

/**
 * Flags of an operation, in field order. Positional fields are not flags. A boolean gets the flag
 * a user passes: `--no-x` when it defaults to true, `--x` when it defaults to false, both when it
 * has no default. Fields listed in `cli.hidden` are marked `hidden`.
 */
export function flagsFor(op: Operation): FlagSpec[] {
  const positional = new Set<string>(op.positional ?? []);
  const hidden = new Set<string>(op.cli?.hidden ?? []);
  return operationFields(op)
    .filter((info) => !positional.has(info.name))
    .flatMap((info) => specsFor(info, op, hidden.has(info.name)));
}

function invalid(field: string, what: string): InputError {
  return new InputError(`Invalid value for --${kebab(field)}: ${what}.`, { fields: [field] });
}

function readFileValue(field: string, raw: string, readFile: (path: string) => string): string {
  if (!raw.startsWith("@")) return raw;
  if (raw.startsWith("@@")) return raw.slice(1);
  const path = raw.slice(1);
  try {
    return readFile(path);
  } catch {
    throw invalid(field, `cannot read the file ${path}`);
  }
}

function coerce(info: FieldInfo, raw: unknown, readFile: (path: string) => string): unknown {
  if (info.kind === "boolean") {
    if (typeof raw === "boolean") return raw;
    throw invalid(info.name, "expected true or false");
  }
  if (typeof raw !== "string") return raw;
  if (info.nullable && raw === "null") return null;
  if (info.kind === "number") {
    const number = raw.trim() === "" ? Number.NaN : Number(raw);
    if (Number.isNaN(number)) throw invalid(info.name, "expected a number");
    return number;
  }
  if (info.kind === "enum") return raw;
  const text = readFileValue(info.name, raw, readFile);
  if (info.kind === "string") return text;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw invalid(info.name, "expected valid JSON");
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
    if (Array.isArray(raw)) values[info.name] = raw.map((item) => coerce(info, item, readFile));
    else values[info.name] = info.array ? [coerce(info, raw, readFile)] : coerce(info, raw, readFile);
  };
  // Positionals fill, in order, the slots that were not given as flags.
  const free = positional.filter((name) => options[optionKey(name)] === undefined);
  for (const name of positional) {
    const info = fields.get(name);
    if (!info) continue;
    const slot = free.indexOf(name);
    set(info, slot >= 0 ? positionals[slot] : options[optionKey(name)]);
  }
  for (const info of fields.values()) {
    if (!positional.includes(info.name)) set(info, options[optionKey(info.name)]);
  }
  return values;
}
