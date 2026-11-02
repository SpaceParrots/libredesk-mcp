/**
 * @module commands/mcp
 * `ldesk mcp install`: register the MCP server in a project's `.mcp.json`, or print the snippet.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import { Option } from "commander";
import type { CliDeps } from "../cli/domain-commands.js";
import { handleCliError, printInfo, printSuccess } from "../cli/output.js";
import { loadConfig, profileNotFound } from "../config.js";
import { resolveProfile } from "../context.js";
import { CancelledError, ConfirmationRequiredError } from "../errors.js";
import { buildServerEntry, mergeMcpJson, type McpServerEntry } from "../services/mcp-config.js";

const SERVER_NAME = "libredesk";
const MCP_FILE = ".mcp.json";

interface InstallOptions {
  scope: "project" | "print";
  mode: "profile" | "env";
  npx?: boolean;
  toolsets?: string;
  profile?: string;
  yes?: boolean;
}

async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function confirmSecretInProject(options: InstallOptions, deps: CliDeps): Promise<void> {
  if (options.yes === true) return;
  printInfo(`Warning: ${MCP_FILE} will now hold the API secret, and this file is often committed.`);
  if (!deps.isTTY) {
    throw new ConfirmationRequiredError(`Writing the API secret into ${MCP_FILE}.`, {
      hint: "Pass --yes to confirm, or use --mode profile to keep the secret out of the file.",
    });
  }
  const ok = await deps.prompt.confirm({ message: `Write the API secret into ${MCP_FILE}?`, initialValue: false });
  if (!ok) throw new CancelledError();
}

async function buildEntry(options: InstallOptions): Promise<McpServerEntry> {
  const common = { useNpx: options.npx === true, toolsets: options.toolsets };
  if (options.mode === "env") {
    const { profile } = await resolveProfile({ override: options.profile });
    return buildServerEntry({ ...common, mode: "env", profile });
  }
  const config = await loadConfig();
  const profileName = options.profile ?? config.activeProfile ?? undefined;
  if (profileName !== undefined && !Object.hasOwn(config.profiles, profileName)) throw profileNotFound(config, profileName);
  return buildServerEntry({ ...common, mode: "profile", profileName });
}

/** Register `ldesk mcp` on `program`. */
export function registerMcp(program: Command, deps: CliDeps): void {
  const mcp = program.command("mcp").description("Set up the MCP server in an MCP client");
  mcp
    .command("install")
    .description("Add the LibreDesk MCP server to ./.mcp.json, or print a snippet for other clients")
    .addOption(new Option("--scope <scope>", "where to put it").choices(["project", "print"]).default("project"))
    .addOption(new Option("--mode <mode>", "pin a stored profile, or copy the credentials into the entry").choices(["profile", "env"]).default("profile"))
    .option("--npx", "run through npx instead of a global ldesk")
    .option("--toolsets <list>", "comma separated toolsets to expose")
    .option("--profile <name>", "profile to pin or copy (default: the active one)")
    .option("--yes", "confirm writing a secret into .mcp.json")
    .action(async (options: InstallOptions) => {
      try {
        const entry = await buildEntry(options);
        if (options.scope === "print") {
          process.stdout.write(`${JSON.stringify({ mcpServers: { [SERVER_NAME]: entry } }, null, 2)}\n`);
          return;
        }
        if (options.mode === "env") await confirmSecretInProject(options, deps);
        const path = join(process.cwd(), MCP_FILE);
        await writeFile(path, mergeMcpJson(await readIfExists(path), SERVER_NAME, entry), "utf8");
        printSuccess(`Added the ${SERVER_NAME} server to ${path}.`);
      } catch (error) {
        (deps.onError ?? handleCliError)(error);
      }
    });
}
