/**
 * @module cli/confirm
 * The two places a command may stop and ask: for required fields the caller left out, and for
 * confirmation before a risky operation. Without a TTY neither ever prompts; both fail with a
 * message naming what to pass instead.
 */

import { ConfirmationRequiredError, DeclinedError, InputError } from "../errors.js";
import { SECRET_KEYS } from "../mask.js";
import type { Impact, Operation } from "../ops/define.js";
import { operationFields, type FieldInfo } from "../ops/fields.js";
import { kebab } from "./flags.js";
import type { PromptAdapter } from "./prompt.js";

/** A typed `null` is a value (it clears a nullable field, as in `--parent-id null`); only absence and "" are missing. */
function isMissing(value: unknown): boolean {
  return value === undefined || value === "";
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

/** Prompt for one field, by kind: confirm, select, number, JSON, list, password or text. */
export async function askField(info: FieldInfo, prompt: PromptAdapter): Promise<unknown> {
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
  for (const info of missing) collected[info.name] = await askField(info, deps.prompt);
  return collected;
}

/** The impact of one run and what it does. */
export interface RunImpact {
  readonly impact: Impact;
  readonly effect: string;
}

function needsConfirmation(impact: Impact): boolean {
  return impact === "caution" || impact === "destructive";
}

/** The impact a run of `op` with `values` has: the escalation when its condition holds, else the operation's own. */
export function impactOf(op: Operation, values: Readonly<Record<string, unknown>>): RunImpact {
  if (op.escalate?.when(values) === true) return { impact: op.escalate.impact, effect: op.escalate.effect };
  return { impact: op.impact, effect: op.effect ?? op.summary };
}

/** True when some run of `op` asks for confirmation, so its command takes `--yes`. */
export function mayAskConfirmation(op: Operation): boolean {
  return needsConfirmation(op.impact) || (op.escalate !== undefined && needsConfirmation(op.escalate.impact));
}

/**
 * Ask for confirmation before a `caution` or `destructive` run: the operation's own impact, or
 * its escalation when `values` meet the escalation's condition. `read` and `write` runs pass.
 * `--yes` passes. Without a TTY this throws {@link ConfirmationRequiredError}; with one it asks
 * (default No) and a No throws {@link DeclinedError}.
 */
export async function confirmImpact(
  op: Operation,
  values: Readonly<Record<string, unknown>>,
  deps: { yes: boolean; isTTY: boolean; prompt: PromptAdapter },
): Promise<void> {
  const { impact, effect } = impactOf(op, values);
  if (!needsConfirmation(impact)) return;
  if (deps.yes) return;
  if (!deps.isTTY) {
    throw new ConfirmationRequiredError(effect, { hint: "Pass --yes to confirm and run it." });
  }
  const confirmed = await deps.prompt.confirm({ message: effect, initialValue: false });
  if (!confirmed) throw new DeclinedError();
}
