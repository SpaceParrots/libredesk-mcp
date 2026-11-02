#!/usr/bin/env node
/**
 * @module index
 * Entry point of the `ldesk` binary.
 */
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { clackPrompts, type PromptAdapter } from "./cli/prompt.js";
import { printResult } from "./cli/output.js";
import { createProgram, notAvailableYet } from "./cli/program.js";
import { runOperation } from "./ops/run.js";

/** What {@link main} may replace; everything defaults to the real thing. */
export interface MainDeps {
  readonly isTTY?: boolean;
  readonly prompt?: PromptAdapter;
  /** Interactive mode. Provided by a later task; defaults to a "not available yet" error. */
  readonly runInteractive?: () => Promise<void>;
  /** MCP server. Provided by a later task; defaults to a "not available yet" error. */
  readonly startServer?: () => Promise<void>;
}

/**
 * Run the CLI. `argv` is the full argument vector (`node`, script, then arguments). Without
 * arguments it starts interactive mode on a terminal and the MCP server otherwise.
 */
export async function main(argv: readonly string[], deps: MainDeps = {}): Promise<void> {
  const isTTY = deps.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const runInteractive = deps.runInteractive ?? notAvailableYet("Interactive mode");
  const startServer = deps.startServer ?? notAvailableYet("The MCP server");
  const cli = { isTTY, prompt: deps.prompt ?? clackPrompts, run: runOperation, print: printResult };
  if (argv.length <= 2) {
    await (isTTY ? runInteractive() : startServer());
    return;
  }
  await createProgram(cli, { runInteractive, startServer }).parseAsync([...argv]);
}

function isEntryPoint(): boolean {
  const script = process.argv[1];
  if (script === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(script)).href;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main(process.argv).catch((error: unknown) => {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
