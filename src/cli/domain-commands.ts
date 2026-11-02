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
import { LIBREDESK_TARGET_VERSION } from "../constants.js";
import { collectMissing, confirmImpact, mayAskConfirmation } from "./confirm.js";
import { flagsFor, kebab, parseFlagValues, type FlagSpec } from "./flags.js";
import { addHelpSection, confirmationLine, HELP_CONFIG, showArgumentsRequired, YES_DESCRIPTION } from "./help.js";
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

/**
 * Summaries name sibling operations as MCP actions (`set_status`); the CLI help names the
 * command instead (`set-status`).
 */
function cliText(domain: Domain, text: string): string {
  return domain.operations.reduce(
    (out, op) => (op.name.includes("_") ? out.replaceAll(new RegExp(`\\b${op.name}\\b`, "g"), commandName(op)) : out),
    text,
  );
}

function describeOperation(domain: Domain, op: Operation): string {
  const lines = [cliText(domain, op.summary)];
  if (op.impact === "caution" || op.impact === "destructive") lines.push(confirmationLine(op.effect ?? op.summary));
  if (op.escalate !== undefined) lines.push(confirmationLine(op.escalate.effect, op.escalate.condition));
  return lines.join("\n\n");
}

/** What the domain command says about undocumented endpoints, or "" when every operation is documented. */
function undocumentedNote(domain: Domain): string {
  const undocumented = domain.operations.filter((op) => op.undocumented === true);
  const docs = `LibreDesk endpoints that are not in the public API docs (built against ${LIBREDESK_TARGET_VERSION}).`;
  if (undocumented.length === 0) return "";
  if (undocumented.length === domain.operations.length) return `Uses ${docs}`;
  return `Some commands (${undocumented.map((op) => commandName(op)).join(", ")}) use ${docs}`;
}

/** The command name of an operation below its domain: `collection list` for `collection_list`. */
function commandName(op: Operation): string {
  return op.group === undefined ? kebab(op.name) : `${kebab(op.group)} ${kebab(op.name.slice(op.group.length + 1))}`;
}

function toOption(spec: FlagSpec): Option {
  const option = new Option(spec.flags, spec.description);
  if (spec.hidden) option.hideHelp();
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

function positionalDescription(field: string, description: string): string {
  return [description, `(required; also --${kebab(field)} <value>)`].filter((part) => part !== "").join(" ");
}

function buildCommand(domain: Domain, op: Operation, name: string, deps: CliDeps): Command {
  const command = new Command(name).summary(cliText(domain, op.summary)).description(describeOperation(domain, op)).configureHelp(HELP_CONFIG);
  const fields = new Map(operationFields(op).map((info) => [info.name, info]));
  // Registered optional so a terminal can ask for a missing one; the help shows them as required.
  for (const field of op.positional ?? []) {
    command.argument(`[${kebab(field)}]`, positionalDescription(field, fields.get(field)?.description ?? ""));
  }
  if ((op.positional ?? []).length > 0) showArgumentsRequired(command);
  for (const option of optionsFor(op)) command.addOption(option);
  // Positional fields can also be given as flags, for scripts that prefer them.
  for (const field of op.positional ?? []) command.addOption(new Option(`--${kebab(field)} <value>`).hideHelp());
  // --yes is listed only where a run may ask; elsewhere it is accepted and does nothing.
  const yes = new Option("--yes", YES_DESCRIPTION);
  command
    .option("--json", "print raw JSON with every field")
    .addOption(mayAskConfirmation(op) ? yes : yes.hideHelp())
    .option("--profile <name>", "use this profile");
  addHelpSection(command, { title: "Notes", lines: op.cli?.notes ?? [], wrap: true });
  addHelpSection(command, { title: "Examples", lines: op.cli?.examples ?? [], wrap: false });

  const positionalCount = op.positional?.length ?? 0;
  command.action(async (...args: unknown[]) => {
    try {
      const options = command.opts<Record<string, unknown>>();
      const positionals = args.slice(0, positionalCount).filter((arg): arg is string => typeof arg === "string");
      const parsed = parseFlagValues(op, options, positionals);
      const values = await collectMissing(op, parsed, deps);
      await confirmImpact(op, values, { yes: options.yes === true, isTTY: deps.isTTY, prompt: deps.prompt });
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
    const note = undocumentedNote(domain);
    const domainCommand = program
      .command(domain.name)
      .summary(domain.summary)
      .description(note === "" ? domain.summary : `${domain.summary}\n\n${note}`)
      .configureHelp(HELP_CONFIG);
    const groups = new Map<string, Command>();
    for (const op of domain.operations) {
      let parent = domainCommand;
      let local = op.name;
      if (op.group !== undefined) {
        let group = groups.get(op.group);
        if (!group) {
          const description = domain.groups?.[op.group] ?? `${op.group} commands`;
          group = domainCommand.command(kebab(op.group)).description(description).configureHelp(HELP_CONFIG);
          groups.set(op.group, group);
        }
        parent = group;
        local = op.name.slice(op.group.length + 1);
      }
      parent.addCommand(buildCommand(domain, op, kebab(local), deps));
    }
  }
}
