/**
 * @module commands/request
 * `ldesk request`: one raw call to any `/api/v1/` path, for anything the typed commands lack.
 */

import { readFile } from "node:fs/promises";
import { Command } from "commander";
import type { CliDeps } from "../cli/domain-commands.js";
import { confirmationLine, YES_DESCRIPTION } from "../cli/help.js";
import { handleCliError } from "../cli/output.js";
import { withProfile } from "../context.js";
import { CancelledError, ConfirmationRequiredError, InputError } from "../errors.js";
import type { HttpMethod } from "../http.js";
import { rawRequest } from "../services/raw-request.js";

const METHODS: readonly HttpMethod[] = ["GET", "POST", "PUT", "DELETE"];

interface RequestOptions {
  query?: string[];
  body?: string;
  yes?: boolean;
  json?: boolean;
  profile?: string;
}

function parseMethod(value: string): HttpMethod {
  const method = METHODS.find((m) => m === value.toUpperCase());
  if (method === undefined) throw new InputError(`Unknown method "${value}".`, { hint: `Use one of ${METHODS.join(", ")}.` });
  return method;
}

function parseQuery(pairs: readonly string[]): Record<string, string> {
  const query: Record<string, string> = {};
  for (const pair of pairs) {
    const at = pair.indexOf("=");
    if (at <= 0) throw new InputError(`Query "${pair}" must look like key=value.`, { hint: "Repeat --query for more parameters." });
    query[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return query;
}

async function parseBody(value: string): Promise<unknown> {
  let text = value;
  if (value.startsWith("@")) {
    try {
      text = await readFile(value.slice(1), "utf8");
    } catch (cause) {
      throw new InputError(`Cannot read the body file ${value.slice(1)}.`, { cause });
    }
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new InputError("The body is not valid JSON.", { hint: "Pass JSON, or @file.json to read it from a file." });
  }
}

/** Register `ldesk request` on `program`. */
export function registerRequest(program: Command, deps: CliDeps): void {
  program
    .command("request")
    .summary("Send a raw request to the LibreDesk API")
    .description(`Send a raw request to the LibreDesk API.\n\n${confirmationLine("A DELETE request deletes data")}`)
    .argument("<method>", `HTTP method: ${METHODS.join(", ")}`)
    .argument("<path>", "path starting with /api/v1/, or /health")
    .option("--query <key=value>", "query parameter, repeatable", (value: string, previous: string[] = []) => [...previous, value])
    .option("--body <json|@file>", "JSON request body, or @file to read it from a file")
    .option("--json", "print the result as JSON")
    .option("--yes", YES_DESCRIPTION)
    .option("--profile <name>", "use this profile")
    .action(async (methodArg: string, path: string, options: RequestOptions) => {
      try {
        const method = parseMethod(methodArg);
        const query = parseQuery(options.query ?? []);
        const body = options.body === undefined ? undefined : await parseBody(options.body);
        let confirm = options.yes === true;
        if (method === "DELETE" && !confirm) {
          if (!deps.isTTY) {
            throw new ConfirmationRequiredError(`DELETE ${path} deletes data.`, { hint: "Pass --yes to confirm and run it." });
          }
          confirm = await deps.prompt.confirm({ message: `DELETE ${path}?`, initialValue: false });
          if (!confirm) throw new CancelledError();
        }
        const result = await withProfile(options.profile, () => rawRequest({ method, path, query, body, confirm }));
        deps.print(result, { json: options.json === true });
      } catch (error) {
        (deps.onError ?? handleCliError)(error);
      }
    });
}
