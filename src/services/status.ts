/**
 * @module services/status
 * Reports which profile is in effect and whether its server answers.
 */

import { getConfigPath } from "../config.js";
import { LIBREDESK_TARGET_VERSION } from "../constants.js";
import { resolveProfile, type ProfileSource } from "../context.js";
import { toLibreDeskError } from "../errors.js";
import { maskValue, redactText } from "../mask.js";
import { verifyCredentials } from "./auth.js";

/** What `ldesk status` prints. */
export interface StatusReport {
  readonly profile: string;
  readonly source: ProfileSource;
  readonly url: string;
  /** Masked. */
  readonly apiKey: string;
  readonly reachable: boolean;
  readonly agent?: string;
  readonly error?: string;
  readonly targetVersion: string;
  readonly configPath: string;
}

/** Dependencies of {@link getStatus}, replaceable in tests. */
export interface StatusDeps {
  /** Profile name to use instead of the resolved one. */
  readonly profile?: string;
  readonly fetchImpl?: typeof fetch;
  readonly env?: NodeJS.ProcessEnv;
}

/** Build the report. An unreachable server or wrong credentials are reported, not thrown; a missing profile throws. */
export async function getStatus(deps: StatusDeps = {}): Promise<StatusReport> {
  const env = deps.env ?? process.env;
  const { profile, source } = await resolveProfile({ override: deps.profile, env });
  const base = {
    profile: profile.name,
    source,
    url: profile.url,
    apiKey: maskValue(profile.apiKey),
    targetVersion: LIBREDESK_TARGET_VERSION,
    configPath: getConfigPath(env),
  };
  try {
    const agent = await verifyCredentials(profile, deps.fetchImpl);
    return { ...base, reachable: true, agent: agent.email };
  } catch (error) {
    const message = redactText(toLibreDeskError(error).message, [profile.apiKey, profile.apiSecret]);
    return { ...base, reachable: false, error: message };
  }
}
