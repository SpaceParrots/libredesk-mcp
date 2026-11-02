/**
 * @module commands/login
 * `ldesk login`: verify credentials against the server and store them as a profile.
 */

import type { Command } from "commander";
import type { CliDeps } from "../cli/domain-commands.js";
import { handleCliError, printSuccess } from "../cli/output.js";
import { assertValidProfileName, loadConfig, normalizeUrl, saveConfig, upsertProfile } from "../config.js";
import { CancelledError, ConfirmationRequiredError, InputError } from "../errors.js";
import { verifyCredentials } from "../services/auth.js";

interface LoginOptions {
  url?: string;
  apiKey?: string;
  apiSecret?: string;
  name?: string;
  yes?: boolean;
}

function checkUrl(value: string): string | undefined {
  try {
    normalizeUrl(value);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "Enter a valid URL.";
  }
}

const required = (value: string): string | undefined => (value.trim() === "" ? "A value is required." : undefined);

/** Profile name derived from a URL: the host name with dots replaced by dashes. */
function defaultProfileName(url: string): string {
  return new URL(url).hostname.toLowerCase().replaceAll(".", "-");
}

async function collectCredentials(options: LoginOptions, deps: CliDeps): Promise<{ url: string; apiKey: string; apiSecret: string }> {
  const flags = [
    options.url ? undefined : "--url",
    options.apiKey ? undefined : "--api-key",
    options.apiSecret ? undefined : "--api-secret",
  ].filter((flag): flag is string => flag !== undefined);
  if (flags.length > 0 && !deps.isTTY) {
    throw new InputError(`Missing required ${flags.length === 1 ? "value" : "values"}: ${flags.join(", ")}.`, {
      hint: "Pass them as flags, or run the command in a terminal to be asked.",
    });
  }
  const url = options.url ?? (await deps.prompt.text({ message: "LibreDesk URL", placeholder: "https://desk.example.com", validate: checkUrl }));
  const apiKey = options.apiKey ?? (await deps.prompt.text({ message: "API key", validate: required }));
  const apiSecret = options.apiSecret ?? (await deps.prompt.password({ message: "API secret" }));
  return { url: normalizeUrl(url), apiKey, apiSecret };
}

/** Register `ldesk login` on `program`. */
export function registerLogin(program: Command, deps: CliDeps): void {
  program
    .command("login")
    .description("Verify credentials and save them as a profile")
    .option("--url <url>", "LibreDesk base URL")
    .option("--api-key <key>", "API key of the agent")
    .option("--api-secret <secret>", "API secret of the agent")
    .option("--name <name>", "profile name (default: the host name with dots replaced by dashes)")
    .option("--yes", "overwrite an existing profile without asking")
    .action(async (options: LoginOptions) => {
      try {
        const credentials = await collectCredentials(options, deps);
        const name = options.name ?? defaultProfileName(credentials.url);
        assertValidProfileName(name);
        const config = await loadConfig();
        if (Object.hasOwn(config.profiles, name) && options.yes !== true) {
          if (!deps.isTTY) {
            throw new ConfirmationRequiredError(`Profile "${name}" already exists.`, {
              hint: "Pass --yes to overwrite it, or --name to save under another name.",
            });
          }
          const overwrite = await deps.prompt.confirm({ message: `Profile "${name}" already exists. Overwrite it?`, initialValue: false });
          if (!overwrite) throw new CancelledError();
        }
        const agent = await verifyCredentials(credentials);
        const next = upsertProfile(config, { name, ...credentials });
        await saveConfig(next);
        const state = next.activeProfile === name ? "active" : "saved";
        printSuccess(`Logged in to ${credentials.url} as ${agent.email}. Profile ${name} is ${state}.`);
      } catch (error) {
        (deps.onError ?? handleCliError)(error);
      }
    });
}
