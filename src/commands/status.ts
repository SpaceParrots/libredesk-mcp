/**
 * @module commands/status
 * `ldesk status`: which profile is in effect and whether its server answers.
 */

import type { Command } from "commander";
import type { CliDeps } from "../cli/domain-commands.js";
import { handleCliError } from "../cli/output.js";
import { getStatus } from "../services/status.js";

/** Register `ldesk status` on `program`. */
export function registerStatus(program: Command, deps: CliDeps): void {
  program
    .command("status")
    .description("Show the profile in effect and whether the server is reachable")
    .option("--json", "print the result as JSON")
    .option("--profile <name>", "use this profile")
    .action(async (options: { json?: boolean; profile?: string }) => {
      try {
        deps.print(await getStatus({ profile: options.profile }), { json: options.json === true });
      } catch (error) {
        (deps.onError ?? handleCliError)(error);
      }
    });
}
