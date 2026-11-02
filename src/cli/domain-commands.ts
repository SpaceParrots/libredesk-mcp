/**
 * @module cli/domain-commands
 * Builds `ldesk <domain> [<group>] <operation>` commands from the operation definitions. The
 * action order is: parse flag values, ask for missing fields, confirm risky operations, run
 * under the chosen profile, print.
 */

import { Command, InvalidArgumentError, Option } from "commander";
import { withProfile } from "../context.js";
import { InputError } from "../errors.js";
import type { Domain, Operation } from "../ops/define.js";
import { operationFields } from "../ops/fields.js";
import type { runOperation } from "../ops/run.js";
import { collectMissing, confirmImpact } from "./confirm.js";
import { flagsFor, kebab, parseFlagValues, type FlagSpec } from "./flags.js";
import { handleCliError, type printResult } from "./output.js";
import type { PromptAdapter } from "./prompt.js";

/** Everything the generated commands need from the outside, so tests can replace it. */
export interface CliDeps {
  /** True when both stdin and stdout are terminals; only then may a command prompt. */
  readonly isTTY: boolean;
  /** Prompts for missing fields and confirmations. */
  readonly prompt: PromptAdapter;
  /** Runs an operation. */
  readonly run: typeof runOperation;
  /** Prints a result. */
  readonly print: typeof printResult;
  /** Handles a thrown error. Defaults to `handleCliError`, which exits the process. */
  readonly onError?: (err: unknown) => never;
}

const RESERVED = new Set(["json", "yes", "profile"]);

function describeOperation(op: Operation): string {
  const head = op.undocumented ? `${op.summary} [undocumented API]` : op.summary;
  return op.impact === "caution" || op.impact === "destructive" ? `${head}\nEffect: ${op.effect ?? ""}` : head;
}

function toOption(spec: FlagSpec): Option {
  const option = new Option(spec.flags, spec.description);
  if (spec.array) {
    const choices = spec.choices;
    option.argParser((value: string, previous: unknown) => {
      if (choices && !choices.includes(value)) {
        throw new InvalidArgumentError(`Allowed values: ${choices.join(", ")}.`);
      }
      return [...(Array.isArray(previous) ? (previous as string[]) : []), value];
    });
  } else if (spec.choices) {
    option.choices(spec.choices);
  }
  return option;
}

/** The opposite flag of a boolean flag: `--x` gives `--no-x` and `--no-x` gives `--x`; undefined for value flags. */
function booleanMirror(flags: string): string | undefined {
  if (flags.includes(" ")) return undefined;
  return flags.startsWith("--no-") ? `--${flags.slice("--no-".length)}` : `--no-${flags.slice("--".length)}`;
}

/**
 * The options of an operation. Every boolean accepts both `--x` and `--no-x`; the flag the help
 * does not list is added hidden. A boolean with only `--no-x` would otherwise default to true in
 * commander and always be sent, and interactive mode prints either form in its repeat command.
 */
function optionsFor(op: Operation): Option[] {
  const specs = flagsFor(op);
  const options: Option[] = [];
  for (const spec of specs) {
    options.push(toOption(spec));
    const mirror = booleanMirror(spec.flags);
    if (mirror !== undefined && !specs.some((other) => other.field === spec.field && other.flags === mirror)) {
      options.push(new Option(mirror).hideHelp());
    }
  }
  return options;
}

function commandPath(command: Command): string {
  const names: string[] = [];
  for (let c: Command | null = command; c?.parent; c = c.parent) names.unshift(c.name());
  return ["ldesk", ...names].join(" ");
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Rewrite an input error from the operation core (snake_case field names) into CLI terms. */
function cliInputError(error: InputError, op: Operation, command: Command): InputError {
  const positional = new Set<string>(op.positional ?? []);
  const path = commandPath(command);
  let message = error.message.replace(`for ${op.name}`, `for \`${path}\``);
  for (const field of error.fields) {
    const flag = positional.has(field) ? `<${kebab(field)}>` : `--${kebab(field)}`;
    message = message.replaceAll(new RegExp(`(^|[:;] )${escapeRegExp(field)}(?=[:.]|$)`, "g"), `$1${flag}`);
  }
  const hint = error.hint === undefined || error.hint.startsWith("Fields of ") ? `Run \`${path} --help\` for the options.` : error.hint;
  return new InputError(message, { fields: error.fields, hint });
}

function buildCommand(op: Operation, name: string, deps: CliDeps): Command {
  const clash = Object.keys(op.input).find((key) => RESERVED.has(key));
  if (clash) throw new Error(`${op.name}: input field ${clash} clashes with the --${clash} flag`);

  const command = new Command(name).description(describeOperation(op));
  const fields = new Map(operationFields(op).map((info) => [info.name, info]));
  for (const field of op.positional ?? []) {
    command.argument(`[${kebab(field)}]`, fields.get(field)?.description ?? "");
  }
  for (const option of optionsFor(op)) command.addOption(option);
  // Positional fields can also be given as flags, for scripts that prefer them.
  for (const field of op.positional ?? []) command.addOption(new Option(`--${kebab(field)} <value>`).hideHelp());
  command
    .option("--json", "print the result as JSON")
    .option("--yes", "confirm without asking")
    .option("--profile <name>", "use this profile");

  const positionalCount = op.positional?.length ?? 0;
  command.action(async (...args: unknown[]) => {
    try {
      const options = command.opts<Record<string, unknown>>();
      const positionals = args.slice(0, positionalCount).filter((arg): arg is string => typeof arg === "string");
      const parsed = parseFlagValues(op, options, positionals);
      const values = await collectMissing(op, parsed, deps);
      await confirmImpact(op, { yes: options.yes === true, isTTY: deps.isTTY, prompt: deps.prompt });
      const profile = typeof options.profile === "string" ? options.profile : undefined;
      const result = await withProfile(profile, () => deps.run(op, values));
      deps.print(result, { json: options.json === true });
    } catch (error) {
      (deps.onError ?? handleCliError)(error instanceof InputError ? cliInputError(error, op, command) : error);
    }
  });
  return command;
}

/**
 * Add one command per domain to `program`, with the domain's operations below it. Grouped
 * operations sit under `<domain> <group>` with the group prefix dropped from their name.
 */
export function addDomainCommands(program: Command, domains: readonly Domain[], deps: CliDeps): void {
  for (const domain of domains) {
    const domainCommand = program.command(domain.name).description(domain.summary);
    const groups = new Map<string, Command>();
    for (const op of domain.operations) {
      let parent = domainCommand;
      let local = op.name;
      if (op.group !== undefined) {
        let group = groups.get(op.group);
        if (!group) {
          group = domainCommand.command(kebab(op.group)).description(`${op.group} commands`);
          groups.set(op.group, group);
        }
        parent = group;
        local = op.name.slice(op.group.length + 1);
      }
      parent.addCommand(buildCommand(op, kebab(local), deps));
    }
  }
}
