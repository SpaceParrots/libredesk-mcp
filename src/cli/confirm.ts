/**
 * @module cli/confirm
 * The two places a command may stop and ask: for required fields the caller left out, and for
 * confirmation before a risky operation. Without a TTY neither ever prompts; both fail with a
 * message naming what to pass instead.
 */

import { CancelledError, ConfirmationRequiredError, InputError } from "../errors.js";
import { SECRET_KEYS } from "../mask.js";
import type { Operation } from "../ops/define.js";
import { operationFields, type FieldInfo } from "../ops/fields.js";
import { kebab } from "./flags.js";
import type { PromptAdapter } from "./prompt.js";

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

const nonEmpty = (v: string) => (v.trim() === "" ? "A value is required." : undefined);

const isNumber = (v: string) => (v.trim() !== "" && !Number.isNaN(Number(v)) ? undefined : "Enter a number.");

function isJson(v: string): string | undefined {
  try {
    JSON.parse(v);
    return undefined;
  } catch {
    return "Enter valid JSON.";
  }
}

async function ask(info: FieldInfo, prompt: PromptAdapter): Promise<unknown> {
  const message = info.description === "" ? info.name : `${info.name}: ${info.description}`;
  if (info.array) {
    const hint = info.enumValues ? ` (${info.enumValues.join(", ")})` : "";
    const line = await prompt.text({ message: `${message}, comma separated${hint}`, validate: nonEmpty });
    return line
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");
  }
  switch (info.kind) {
    case "boolean":
      return prompt.confirm({ message });
    case "enum":
      return prompt.select({ message, options: (info.enumValues ?? []).map((value) => ({ value, label: value })) });
    case "number":
      return Number(await prompt.text({ message, validate: isNumber }));
    case "json":
      return JSON.parse(await prompt.text({ message, validate: isJson })) as unknown;
    default:
      return SECRET_KEYS.includes(info.name.toLowerCase())
        ? prompt.password({ message })
        : prompt.text({ message, validate: nonEmpty });
  }
}

/**
 * Fill in required fields the caller did not pass. Without a TTY this throws an
 * {@link InputError} listing them as `--flag` (or `<name>` for positional ones). With a TTY each
 * missing field is prompted for. Returns a new object; `values` is not modified.
 */
export async function collectMissing(
  op: Operation,
  values: Record<string, unknown>,
  deps: { isTTY: boolean; prompt: PromptAdapter },
): Promise<Record<string, unknown>> {
  const missing = operationFields(op).filter((info) => info.required && isMissing(values[info.name]));
  if (missing.length === 0) return { ...values };
  if (!deps.isTTY) {
    const positional = new Set<string>(op.positional ?? []);
    const names = missing.map((info) => (positional.has(info.name) ? `<${kebab(info.name)}>` : `--${kebab(info.name)}`));
    throw new InputError(`Missing required ${names.length === 1 ? "value" : "values"}: ${names.join(", ")}.`, {
      fields: missing.map((info) => info.name),
      hint: "Pass them as flags, or run the command in a terminal to be asked.",
    });
  }
  const collected: Record<string, unknown> = { ...values };
  for (const info of missing) collected[info.name] = await ask(info, deps.prompt);
  return collected;
}

/**
 * Ask for confirmation before a `caution` or `destructive` operation. `read` and `write`
 * operations pass. `--yes` passes. Without a TTY this throws {@link ConfirmationRequiredError};
 * with one it asks (default No) and a No throws {@link CancelledError}.
 */
export async function confirmImpact(
  op: Operation,
  deps: { yes: boolean; isTTY: boolean; prompt: PromptAdapter },
): Promise<void> {
  if (op.impact !== "caution" && op.impact !== "destructive") return;
  if (deps.yes) return;
  const effect = op.effect ?? op.summary;
  if (!deps.isTTY) {
    throw new ConfirmationRequiredError(effect, { hint: "Pass --yes to confirm and run it." });
  }
  const confirmed = await deps.prompt.confirm({ message: effect, initialValue: false });
  if (!confirmed) throw new CancelledError();
}
