/**
 * @module cli/interactive
 * Interactive mode: a menu that walks through any domain operation (domain, operation, fields,
 * confirmation, run) and prints the equivalent command line afterwards.
 */

import { withProfile } from "../context.js";
import { CancelledError } from "../errors.js";
import type { Domain, Operation } from "../ops/define.js";
import { operationFields, type FieldInfo } from "../ops/fields.js";
import { askField, collectMissing, confirmImpact } from "./confirm.js";
import type { CliDeps } from "./domain-commands.js";
import { kebab } from "./flags.js";
import { handleCliError, printError } from "./output.js";

const DONE = "(done)";
const PLAIN = /^[\w./:=+,-]+$/;

function quote(value: string): string {
  const text = value.startsWith("@") ? `@${value}` : value;
  return PLAIN.test(text) && !text.startsWith("-") ? text : `"${text.replaceAll(/[\\"$`]/g, String.raw`\$&`)}"`;
}

function render(info: FieldInfo, value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") return String(value);
  if (info.kind === "json" && !info.array) return `'${(JSON.stringify(value) ?? "").replaceAll("'", String.raw`'\''`)}'`;
  return quote(String(value));
}

/** The shell command that repeats a run with `values`: positionals first, then flags in field order. */
export function commandLineFor(domain: Domain, op: Operation, values: Record<string, unknown>): string {
  const path = ["ldesk", domain.name];
  if (op.group !== undefined) path.push(kebab(op.group), kebab(op.name.slice(op.group.length + 1)));
  else path.push(kebab(op.name));
  const fields = new Map(operationFields(op).map((info) => [info.name, info]));
  const given = (name: string) => values[name] !== undefined;
  const parts = [...path];
  const bare = new Set<string>();
  for (const name of op.positional ?? []) {
    if (!given(name) || fields.get(name)?.array === true) break;
    bare.add(name);
    parts.push(render(fields.get(name) as FieldInfo, values[name]));
  }
  for (const [name, info] of fields) {
    const value = values[name];
    if (value === undefined || bare.has(name)) continue;
    const flag = `--${kebab(name)}`;
    if (typeof value === "boolean") parts.push(value ? flag : `--no-${kebab(name)}`);
    else if (Array.isArray(value) && info.array) for (const item of value) parts.push(flag, render(info, item));
    else parts.push(flag, render(info, value));
  }
  return parts.join(" ");
}

async function askOptional(op: Operation, values: Record<string, unknown>, deps: CliDeps): Promise<void> {
  const optional = operationFields(op).filter((info) => !info.required);
  if (optional.length === 0) return;
  if (!(await deps.prompt.confirm({ message: "Set optional fields?", initialValue: false }))) return;
  for (;;) {
    const open = optional.filter((info) => values[info.name] === undefined);
    if (open.length === 0) return;
    const pick = await deps.prompt.select<string>({
      message: "Which field?",
      options: [
        ...open.map((info) => ({ value: info.name, label: info.name, hint: info.description })),
        { value: DONE, label: "Done" },
      ],
    });
    const info = open.find((field) => field.name === pick);
    if (info === undefined) return;
    values[info.name] = await askField(info, deps.prompt);
  }
}

async function runOnce(domains: readonly Domain[], deps: CliDeps): Promise<void> {
  const domainName = await deps.prompt.select<string>({
    message: "Domain",
    options: domains.map((d) => ({ value: d.name, label: d.summary, hint: d.name })),
  });
  const domain = domains.find((d) => d.name === domainName) as Domain;
  const opName = await deps.prompt.select<string>({
    message: "Operation",
    options: domain.operations.map((o) => ({
      value: o.name,
      label: o.summary,
      hint: o.undocumented ? `${o.impact}, undocumented` : o.impact,
    })),
  });
  const op = domain.operations.find((o) => o.name === opName) as Operation;
  const entered = await collectMissing(op, {}, { isTTY: true, prompt: deps.prompt });
  await askOptional(op, entered, deps);
  await confirmImpact(op, { yes: false, isTTY: true, prompt: deps.prompt });
  const result = await withProfile(undefined, () => deps.run(op, entered));
  deps.print(result, { json: false });
  deps.prompt.note(commandLineFor(domain, op, entered), "Run it again with");
}

/**
 * Walk the user through operations until they stop. A failed run is printed and the loop goes on;
 * a cancelled prompt ends the session through the error handler (exit 130).
 */
export async function runInteractive(domains: readonly Domain[], deps: CliDeps): Promise<void> {
  for (;;) {
    let again = false;
    try {
      try {
        await runOnce(domains, deps);
      } catch (error) {
        if (error instanceof CancelledError) throw error;
        printError(error);
      }
      again = await deps.prompt.confirm({ message: "Do something else?", initialValue: true });
    } catch (error) {
      (deps.onError ?? handleCliError)(error);
    }
    if (!again) return;
  }
}
