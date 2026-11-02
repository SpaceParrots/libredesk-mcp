/**
 * @module services/auth
 * Checks a set of credentials against a LibreDesk server before they are stored.
 */

import { normalizeUrl } from "../config.js";
import { BASE_URL_HINT } from "../constants.js";
import { ApiError } from "../errors.js";
import { isRecord } from "../guards.js";
import { request } from "../http.js";

/** The agent a set of credentials belongs to. */
export interface VerifiedAgent {
  readonly id: number;
  readonly email: string;
  readonly first_name: string;
  readonly last_name: string;
}

/** Credentials to verify. */
export interface CredentialInput {
  readonly url: string;
  readonly apiKey: string;
  readonly apiSecret: string;
}

/** Ask the server who the credentials belong to (`GET /api/v1/agents/me`). Throws a typed error when they are wrong. */
export async function verifyCredentials(input: CredentialInput, fetchImpl?: typeof fetch): Promise<VerifiedAgent> {
  const profile = { name: "verify", url: normalizeUrl(input.url), apiKey: input.apiKey, apiSecret: input.apiSecret };
  const agent = await request<unknown>(profile, "GET", "/api/v1/agents/me", { fetchImpl });
  if (!isRecord(agent) || typeof agent.email !== "string") {
    throw new ApiError("The server answered, but not with an agent record.", { status: 200, hint: BASE_URL_HINT });
  }
  return agent as unknown as VerifiedAgent;
}
