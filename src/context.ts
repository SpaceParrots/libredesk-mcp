/**
 * @module context
 * Answers "which profile, and why" for every call path. Order: explicit override, the three
 * credential env vars, `LIBREDESK_PROFILE`, a project link matching the cwd, the active profile.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { loadConfig, normalizeProjectPath, normalizeUrl, profileNotFound, type LibreDeskConfig, type Profile } from "./config.js";
import { ENV, IMPLICIT_ENV_PROFILE } from "./constants.js";
import { ConfigError, NoProfileError } from "./errors.js";

/** What selected a resolved profile. */
export type ProfileSource = "param" | "env" | "LIBREDESK_PROFILE" | "project" | "active";

/** A profile together with the source that selected it. */
export interface ResolvedProfile {
  readonly profile: Profile;
  readonly source: ProfileSource;
}

/** Inputs for {@link resolveProfile}; every field defaults to the process state. */
export interface ResolveProfileOptions {
  readonly override?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  readonly config?: LibreDeskConfig;
}

const storage = new AsyncLocalStorage<string | undefined>();

function stored(config: LibreDeskConfig, name: string): Profile {
  const found = config.profiles[name];
  if (found === undefined) throw profileNotFound(config, name);
  return { name, ...found };
}

function envProfile(env: NodeJS.ProcessEnv): Profile | undefined {
  const names = [ENV.URL, ENV.API_KEY, ENV.API_SECRET] as const;
  const [url, apiKey, apiSecret] = names.map((n) => env[n] || undefined);
  if (url === undefined && apiKey === undefined && apiSecret === undefined) return undefined;
  if (url === undefined || apiKey === undefined || apiSecret === undefined) {
    const missing = names.filter((n) => !env[n]);
    throw new ConfigError(`Incomplete credentials in the environment: missing ${missing.join(", ")}.`, {
      hint: `Set all of ${names.join(", ")}, or unset them to use a stored profile.`,
    });
  }
  return { name: IMPLICIT_ENV_PROFILE, url: normalizeUrl(url), apiKey, apiSecret };
}

function findProjectLink(config: LibreDeskConfig, cwd: string): string | undefined {
  const target = normalizeProjectPath(cwd);
  let best: { length: number; name: string } | undefined;
  for (const [path, name] of Object.entries(config.projects)) {
    const link = normalizeProjectPath(path);
    if (target !== link && !target.startsWith(`${link}/`)) continue;
    if (best === undefined || link.length > best.length) best = { length: link.length, name };
  }
  return best?.name;
}

/** Resolve the effective profile. Throws {@link NoProfileError} when nothing selects one. */
export async function resolveProfile(opts: ResolveProfileOptions = {}): Promise<ResolvedProfile> {
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? process.cwd();
  if (!opts.override) {
    const fromEnv = envProfile(env);
    if (fromEnv !== undefined) return { profile: fromEnv, source: "env" };
  }
  const config = opts.config ?? (await loadConfig(env));

  if (opts.override) return { profile: stored(config, opts.override), source: "param" };
  const named = env[ENV.PROFILE];
  if (named) return { profile: stored(config, named), source: "LIBREDESK_PROFILE" };
  const linked = findProjectLink(config, cwd);
  if (linked !== undefined) return { profile: stored(config, linked), source: "project" };
  if (config.activeProfile !== null) return { profile: stored(config, config.activeProfile), source: "active" };

  throw new NoProfileError("No LibreDesk profile configured.", {
    hint: `Run \`ldesk login\`, or set ${ENV.URL}, ${ENV.API_KEY} and ${ENV.API_SECRET}.`,
  });
}

/** Run `fn` with `name` as the ambient profile override. */
export function withProfile<T>(name: string | undefined, fn: () => Promise<T>): Promise<T> {
  return storage.run(name, fn);
}

/** Resolve the profile for the current call, honouring a {@link withProfile} override. */
export function getCurrentProfile(): Promise<ResolvedProfile> {
  return resolveProfile({ override: storage.getStore() });
}
