/**
 * @module commands/doctor
 * `ldesk doctor`: check Node, the profile, and whether the MCP client can start the server. It
 * launches every LibreDesk entry of the client config the way the client does, because a client
 * usually shows only "failed to connect" when the command itself is the problem.
 */

import type { Command } from "commander";
import type { CliDeps } from "../cli/domain-commands.js";
import { EXIT_ERROR, handleCliError } from "../cli/output.js";
import { InputError } from "../errors.js";
import { DEFAULT_LAUNCH_TIMEOUT_MS, runDoctor, type DoctorDeps, type DoctorReport, type LaunchRequest } from "../services/doctor.js";

/** What tests may replace in {@link runDoctor}; the flags set the rest. */
export type DoctorOverrides = Omit<DoctorDeps, "profile" | "timeoutMs" | "confirmLaunch">;

/** The question doctor asks before it starts an entry the current folder can influence. */
export function launchQuestion(request: LaunchRequest): string {
  const where = request.scope === "project" ? "from ./.mcp.json" : "in this folder";
  return `Start "${request.name}" ${where}? It runs: ${request.command} (${request.reasons.join("; ")})`;
}

const STATE_WIDTH = 6;

/** Render the report: one line per check, then its notes, output and fix, indented under the detail. */
export function formatDoctorReport(report: DoctorReport): string {
  const nameWidth = Math.max(...report.checks.map((check) => check.name.length));
  const indent = " ".repeat(STATE_WIDTH + nameWidth + 2);
  const lines: string[] = [];
  for (const check of report.checks) {
    lines.push(`${check.state.padEnd(STATE_WIDTH)}${check.name.padEnd(nameWidth)}  ${check.detail}`);
    for (const note of check.notes ?? []) lines.push(`${indent}${note}`);
    for (const line of check.output ?? []) lines.push(`${indent}| ${line}`);
    (check.fix ?? []).forEach((line, i) => lines.push(`${indent}${i === 0 ? "fix: " : "     "}${line}`));
  }
  const failed = report.checks.filter((check) => check.state === "fail").length;
  lines.push(failed === 0 ? "No problems found." : `${failed} ${failed === 1 ? "check" : "checks"} failed.`);
  return lines.join("\n");
}

function parseTimeout(value: string | undefined): number {
  if (value === undefined) return DEFAULT_LAUNCH_TIMEOUT_MS;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new InputError(`--timeout must be a positive number of seconds, got "${value}".`);
  return Math.round(seconds * 1000);
}

/** Register `ldesk doctor` on `program`. */
export function registerDoctor(program: Command, deps: CliDeps, overrides: DoctorOverrides = {}): void {
  program
    .command("doctor")
    .summary("Check Node, the profile, and how the MCP client starts the server")
    .description(
      [
        "Check Node, the profile, and how the MCP client starts the server.",
        "Prints the Node version and the path of this ldesk, the profile in effect and whether its server answers (as ldesk status), and the LibreDesk entries in ~/.claude.json (user scope and this folder's local scope) and ./.mcp.json. It starts each entry exactly as configured, sends the MCP initialize request and reports the answer, or the exit code and the last lines the server printed. When an entry fails but node with this ldesk works, it prints the claude mcp add line that uses it. Commands are shown as written in the config; env values are never printed, only their names.",
        "Run it in the folder where the MCP client runs, since local and project entries depend on it. The folder may be a cloned repo, so doctor shows the command and asks before it starts an entry the folder supplies or can redirect: an entry of ./.mcp.json, a command path inside the folder, npx or another package runner next to a package.json, node_modules or .npmrc, or on Windows a file in the folder named like the command. Without a terminal such an entry is skipped unless --yes is given.",
        "Exits 1 when any check fails.",
      ].join("\n\n"),
    )
    .option("--json", "print the result as JSON")
    .option("--profile <name>", "use this profile for the profile check")
    .option("--timeout <seconds>", `how long each launch may take to answer (default ${DEFAULT_LAUNCH_TIMEOUT_MS / 1000})`)
    .option("--yes", "start entries this folder supplies or can redirect without asking")
    .action(async (options: { json?: boolean; profile?: string; timeout?: string; yes?: boolean }) => {
      try {
        const confirmLaunch = (request: LaunchRequest): Promise<boolean> => {
          if (options.yes === true) return Promise.resolve(true);
          if (!deps.isTTY) return Promise.resolve(false);
          return deps.prompt.confirm({ message: launchQuestion(request), initialValue: false });
        };
        const report = await runDoctor({ ...overrides, profile: options.profile, timeoutMs: parseTimeout(options.timeout), confirmLaunch });
        const json = options.json === true;
        deps.print(json ? report : formatDoctorReport(report), { json });
        // Set rather than exit, so the report is flushed before the process ends.
        if (!report.ok) process.exitCode = EXIT_ERROR;
      } catch (error) {
        (deps.onError ?? handleCliError)(error);
      }
    });
}
