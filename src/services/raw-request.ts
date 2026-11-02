/**
 * @module services/raw-request
 * Escape hatch for `ldesk request`: one authenticated call to any `/api/v1/` path.
 */

import type { Profile } from "../config.js";
import { getCurrentProfile } from "../context.js";
import { ConfirmationRequiredError, InputError } from "../errors.js";
import { request, type HttpMethod, type QueryValue } from "../http.js";

/** Input of {@link rawRequest}. */
export interface RawRequestInput {
  readonly method: HttpMethod;
  readonly path: string;
  readonly query?: Readonly<Record<string, QueryValue>>;
  readonly body?: unknown;
  /** Required for DELETE. */
  readonly confirm?: boolean;
}

/** Dependencies of {@link rawRequest}, replaceable in tests. */
export interface RawRequestDeps {
  readonly profile?: Profile;
  readonly fetchImpl?: typeof fetch;
  /** Who is calling; decides how hints name the query option and shell quirks. Defaults to `cli`. */
  readonly caller?: "cli" | "mcp";
}

const PATH_HINT = "Use a path that starts with /api/v1/, or /health.";
const CLI_PATH_HINT = `${PATH_HINT} In Git Bash, set MSYS_NO_PATHCONV=1 or omit the leading slash.`;
const QUERY_HINTS = {
  cli: "Pass query parameters with --query key=value, not in the path.",
  mcp: "Pass query parameters in the query field, not in the path.",
} as const;

/** Validate a request path the way the URL parser will read it; returns it with a leading slash. */
function checkedPath(path: string, caller: "cli" | "mcp"): string {
  const withSlash = path.startsWith("/") ? path : `/${path}`;
  const reject = (hint: string = caller === "cli" ? CLI_PATH_HINT : PATH_HINT): never => {
    throw new InputError(`Path "${path}" is not allowed.`, { hint });
  };
  if (/[?#]/.test(withSlash)) return reject(QUERY_HINTS[caller]);
  if (withSlash.includes("\\") || /%(2e|2f|5c)/i.test(withSlash)) return reject();
  const { pathname } = new URL(withSlash, "http://placeholder.invalid");
  const allowed = pathname === "/health" || (pathname.startsWith("/api/v1/") && pathname.length > "/api/v1/".length);
  return allowed ? withSlash : reject();
}

/** Send the request as the current profile and return the unwrapped response. */
export async function rawRequest(input: RawRequestInput, deps: RawRequestDeps = {}): Promise<unknown> {
  const path = checkedPath(input.path, deps.caller ?? "cli");
  if (input.method === "DELETE" && input.confirm !== true) {
    throw new ConfirmationRequiredError(`DELETE ${path} deletes data.`, { hint: "Pass --yes to confirm and run it." });
  }
  const profile = deps.profile ?? (await getCurrentProfile()).profile;
  return request(profile, input.method, path, { query: input.query, body: input.body, fetchImpl: deps.fetchImpl });
}
