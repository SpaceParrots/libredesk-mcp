/**
 * @module commands/profile
 * `ldesk profile list | use | remove | link | unlink`: manage stored profiles.
 */

import type { Command } from "commander";
import type { CliDeps } from "../cli/domain-commands.js";
import { handleCliError, printSuccess } from "../cli/output.js";
import { linkProject, loadConfig, removeProfile, saveConfig, unlinkProject, useProfile } from "../config.js";
import { resolveProfile } from "../context.js";
import { InputError } from "../errors.js";

async function resolvedName(): Promise<string | undefined> {
  try {
    return (await resolveProfile()).profile.name;
  } catch {
    return undefined;
  }
}

/** Register `ldesk profile` on `program`. */
export function registerProfile(program: Command, deps: CliDeps): void {
  const fail = (error: unknown): never => (deps.onError ?? handleCliError)(error);
  const profile = program.command("profile").description("Manage stored profiles");

  profile
    .command("list")
    .description("List profiles; * marks the active one and the one in effect here")
    .option("--json", "print the result as JSON")
    .action(async (options: { json?: boolean }) => {
      try {
        const config = await loadConfig();
        const current = await resolvedName();
        const rows = Object.entries(config.profiles).map(([name, stored]) => ({
          name,
          active: config.activeProfile === name ? "*" : "",
          resolved: current === name ? "*" : "",
          url: stored.url,
        }));
        deps.print(rows, { json: options.json === true });
      } catch (error) {
        fail(error);
      }
    });

  profile
    .command("use")
    .description("Make a profile the active one")
    .argument("<name>", "profile name")
    .action(async (name: string) => {
      try {
        await saveConfig(useProfile(await loadConfig(), name));
        printSuccess(`Profile ${name} is now active.`);
      } catch (error) {
        fail(error);
      }
    });

  profile
    .command("remove")
    .description("Delete a profile and the project links pointing at it")
    .argument("<name>", "profile name")
    .action(async (name: string) => {
      try {
        await saveConfig(removeProfile(await loadConfig(), name));
        printSuccess(`Profile ${name} removed.`);
      } catch (error) {
        fail(error);
      }
    });

  profile
    .command("link")
    .description("Use a profile whenever a command runs inside the current directory")
    .argument("[name]", "profile name")
    .action(async (name: string | undefined) => {
      try {
        const config = await loadConfig();
        let target = name;
        if (target === undefined) {
          const names = Object.keys(config.profiles);
          if (!deps.isTTY || names.length === 0) {
            throw new InputError("Missing required value: <name>.", {
              fields: ["name"],
              hint: names.length === 0 ? "Add a profile with `ldesk login` first." : `Pass one of: ${names.join(", ")}.`,
            });
          }
          target = await deps.prompt.select({ message: "Profile for this directory", options: names.map((n) => ({ value: n, label: n })) });
        }
        const cwd = process.cwd();
        await saveConfig(linkProject(config, cwd, target));
        printSuccess(`${cwd} now uses profile ${target}.`);
      } catch (error) {
        fail(error);
      }
    });

  profile
    .command("unlink")
    .description("Remove the profile link of the current directory")
    .action(async () => {
      try {
        const cwd = process.cwd();
        await saveConfig(unlinkProject(await loadConfig(), cwd));
        printSuccess(`${cwd} is no longer linked to a profile.`);
      } catch (error) {
        fail(error);
      }
    });
}
