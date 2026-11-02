/**
 * @module cli/help
 * Help output an agent can act on without guessing. Commander's built-in help is extended in
 * three ways: extra sections after the options (notes, examples, the root "For scripts and
 * agents" text) that `helpInformation()` itself returns, required positionals shown as `<name>`
 * although they are registered optional (so a terminal can still ask for them), and group
 * listings that show a command's real usage.
 */

import { Help, type Argument, type Command, type HelpConfiguration } from "commander";

/** A titled block printed after the options. */
export interface HelpSection {
  /** Heading without the colon, for example "Examples". */
  readonly title: string;
  /** One entry per paragraph or command line. */
  readonly lines: readonly string[];
  /** Bulleted and wrapped to the help width (notes), or printed as is (command lines). */
  readonly wrap: boolean;
}

/** Description of the `--yes` flag, the same on every command that may ask. */
export const YES_DESCRIPTION = "confirm without asking (required when no terminal is attached)";

/** The line a confirming command's help carries: `Asks for confirmation[ when <condition>]: <effect>.` */
export function confirmationLine(effect: string, condition?: string): string {
  const sentence = /[.!?]$/.test(effect) ? effect : `${effect}.`;
  return `Asks for confirmation${condition === undefined ? "" : ` when ${condition}`}: ${sentence}`;
}

/** The root help's guidance for running `ldesk` from scripts and agents. */
export const AGENT_GUIDE: HelpSection = {
  title: "For scripts and agents",
  wrap: true,
  lines: [
    "Typical flow: `ldesk status` to check the login, a list command or `ldesk lookup ...` to find ids, then the action.",
    "Output is a table or key: value lines; --json prints raw JSON with every field.",
    'Without a terminal nothing ever prompts: missing required values fail naming the flags, and commands whose help says "Asks for confirmation" need --yes.',
    "Any text or JSON value can be read from a file with @path, for example --content @article.md; @@ stands for a literal leading @.",
    "The value null clears a field that allows it, for example --parent-id null.",
    "Exit codes: 0 ok, 1 error, 130 cancelled.",
    "`ldesk catalog` lists every operation; `ldesk <command> --help` shows options, notes and examples.",
    "`ldesk` with no arguments opens an interactive menu in a terminal, and starts the MCP server on stdio otherwise.",
  ],
};

const sections = new WeakMap<Command, readonly HelpSection[]>();
const requiredArguments = new WeakSet<Argument>();
const usageTerms = new WeakSet<Command>();

const INDENT = "  ";
const BULLET = "- ";

function formatSection(section: HelpSection, helper: Help): string {
  const width = (helper.helpWidth ?? 80) - INDENT.length - BULLET.length;
  const lines = section.lines.flatMap((line) => {
    if (!section.wrap) return [`${INDENT}${line}`];
    const [first = "", ...rest] = helper.boxWrap(line, width).split("\n");
    return [`${INDENT}${BULLET}${first}`, ...rest.map((part) => `${INDENT}${" ".repeat(BULLET.length)}${part}`)];
  });
  return [`${section.title}:`, ...lines].join("\n");
}

/** Help settings every `ldesk` command uses; apply with `command.configureHelp(HELP_CONFIG)`. */
export const HELP_CONFIG: HelpConfiguration = {
  argumentTerm(argument: Argument): string {
    return argument.required || requiredArguments.has(argument) ? `<${argument.name()}>` : `[${argument.name()}]`;
  },
  subcommandTerm(sub: Command): string {
    return usageTerms.has(sub) ? `${sub.name()} ${sub.usage()}` : Help.prototype.subcommandTerm.call(this, sub);
  },
  formatHelp(cmd: Command, helper: Help): string {
    const base = Help.prototype.formatHelp.call(helper, cmd, helper);
    const extra = sections.get(cmd) ?? [];
    if (extra.length === 0) return base;
    return `${base}\n${extra.map((section) => formatSection(section, helper)).join("\n\n")}\n`;
  },
};

/** Print `section` after the options of `command`, after any added before. Returns `command`. */
export function addHelpSection(command: Command, section: HelpSection): Command {
  if (section.lines.length > 0) sections.set(command, [...(sections.get(command) ?? []), section]);
  return command;
}

/**
 * Show the registered (optional) arguments of `command` as required `<name>` in its usage, its
 * argument list and the listing of its parent. They stay optional to commander, so a missing one
 * can still be asked for on a terminal or given as a flag.
 */
export function showArgumentsRequired(command: Command): Command {
  const args = command.registeredArguments;
  for (const argument of args) requiredArguments.add(argument);
  usageTerms.add(command);
  return command.usage(["[options]", ...args.map((argument) => `<${argument.name()}>`)].join(" "));
}
