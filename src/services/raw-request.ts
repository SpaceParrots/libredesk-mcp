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
}

function assertAllowedPath(path: string): void {
  const pathOnly = path.split(/[?#]/)[0] ?? path;
  const allowed = pathOnly === "/health" || (pathOnly.startsWith("/api/v1/") && pathOnly.length > "/api/v1/".length);
  if (!allowed || pathOnly.split("/").includes("..")) {
    throw new InputError(`Path "${path}" is not allowed.`, {
      hint: "Use a path that starts with /api/v1/, or /health.",
    });
  }
}

/** Send the request as the current profile and return the unwrapped response. */
export async function rawRequest(input: RawRequestInput, deps: RawRequestDeps = {}): Promise<unknown> {
  assertAllowedPath(input.path);
  if (input.method === "DELETE" && input.confirm !== true) {
    throw new ConfirmationRequiredError(`DELETE ${input.path} deletes data.`, { hint: "Pass --yes to confirm and run it." });
  }
  const profile = deps.profile ?? (await getCurrentProfile()).profile;
  return request(profile, input.method, input.path, { query: input.query, body: input.body, fetchImpl: deps.fetchImpl });
}
