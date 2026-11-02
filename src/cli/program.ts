/**
 * @module cli/program
 * Builds the `ldesk` command tree: built-in commands first, then one command per domain.
 */

import { createRequire } from "node:module";
import { Command } from "commander";
import { registerLogin } from "../commands/login.js";
import { registerMcp } from "../commands/mcp.js";
import { registerProfile } from "../commands/profile.js";
import { registerRequest } from "../commands/request.js";
import { registerStatus } from "../commands/status.js";
import { BIN_NAME, LIBREDESK_TARGET_VERSION } from "../constants.js";
import { DOMAINS } from "../domains/index.js";
import { InputError } from "../errors.js";
import { startMcpServer } from "../mcp/server.js";
import { buildCatalog } from "../ops/catalog.js";
import { addDomainCommands, type CliDeps } from "./domain-commands.js";
import { runInteractive } from "./interactive.js";
import { handleCliError } from "./output.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

/** The long-running modes, replaceable in tests. */
export interface ProgramExtras {
  /** Interactive mode (`ldesk i`). */
  readonly runInteractive?: () => Promise<void>;
  /** MCP server on stdio (`ldesk serve`). Defaults to {@link startMcpServer}. */
  readonly startServer?: () => Promise<void>;
}

/** Create the `ldesk` program. Nothing runs until it is parsed. */
export function createProgram(deps: CliDeps, extras: ProgramExtras = {}): Command {
  const fail = (error: unknown): never => (deps.onError ?? handleCliError)(error);
  const program = new Command(BIN_NAME)
    .version(pkg.version)
    .description(`CLI and MCP server for the LibreDesk helpdesk API (built for LibreDesk ${LIBREDESK_TARGET_VERSION}).`);

  registerLogin(program, deps);
  registerProfile(program, deps);
  registerStatus(program, deps);
  registerRequest(program, deps);
  registerMcp(program, deps);

  program
    .command("catalog")
    .description("List every operation with its method, path and impact")
    .argument("[domain]", "only this domain")
    .option("--json", "print the full entries as JSON")
    .action((domain: string | undefined, options: { json?: boolean }) => {
      try {
        const entries = buildCatalog(DOMAINS, domain);
        if (entries.length === 0) {
          throw new InputError(`No domain "${domain ?? ""}".`, { hint: `Known domains: ${DOMAINS.map((d) => d.name).join(", ")}.` });
        }
        const rows = options.json === true ? entries : entries.map(({ tool, action, method, path, impact }) => ({ tool, action, method, path, impact }));
        deps.print(rows, { json: options.json === true });
      } catch (error) {
        fail(error);
      }
    });

  program
    .command("serve")
    .description("Start the MCP server on stdio")
    .action(async () => {
      try {
        await (extras.startServer ?? startMcpServer)();
      } catch (error) {
        fail(error);
      }
    });

  program
    .command("i")
    .description("Interactive mode")
    .action(async () => {
      try {
        await (extras.runInteractive ?? (() => runInteractive(DOMAINS, deps)))();
      } catch (error) {
        fail(error);
      }
    });

  addDomainCommands(program, DOMAINS, deps);
  return program;
}
