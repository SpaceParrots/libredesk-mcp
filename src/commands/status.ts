/**
 * @module commands/status
 * `ldesk status`: which profile is in effect and whether its server answers. The exit code says
 * the same, so scripts can use it as a check.
 */

import type { Command } from "commander";
import type { CliDeps } from "../cli/domain-commands.js";
import { EXIT_ERROR, handleCliError } from "../cli/output.js";
import { getStatus } from "../services/status.js";

/** Register `ldesk status` on `program`. */
export function registerStatus(program: Command, deps: CliDeps): void {
  program
    .command("status")
    .summary("Show the profile in effect and whether the server is reachable")
    .description(
      "Show the profile in effect and whether the server is reachable.\n\nExits 0 when the server is reachable. Exits 1 when no profile is set up (with an error) or the server is not reachable (after printing the report).",
    )
    .option("--json", "print the result as JSON")
    .option("--profile <name>", "use this profile")
    .action(async (options: { json?: boolean; profile?: string }) => {
      try {
        const report = await getStatus({ profile: options.profile });
        deps.print(report, { json: options.json === true });
        // Set rather than exit, so the report is flushed before the process ends.
        if (!report.reachable) process.exitCode = EXIT_ERROR;
      } catch (error) {
        (deps.onError ?? handleCliError)(error);
      }
    });
}
