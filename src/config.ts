/**
 * @module config
 * The profile store at `~/.libredesk-mcp/config.json`: types, load/save, and pure transforms.
 * Transforms never touch the disk; callers load, transform, then save.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_CONFIG_DIR_NAME, ENV } from "./constants.js";
import { ConfigError, ProfileNotFoundError } from "./errors.js";
import { isRecord } from "./guards.js";

/** A profile with its name: what the rest of the package works with. */
export interface Profile {
  readonly name: string;
  readonly url: string;
  readonly apiKey: string;
  readonly apiSecret: string;
}

/** A profile as stored on disk, keyed by name in {@link LibreDeskConfig.profiles}. */
export interface StoredProfile {
  readonly url: string;
  readonly apiKey: string;
  readonly apiSecret: string;
}

/** Contents of the config file. */
export interface LibreDeskConfig {
  /** Name of the profile used when nothing else selects one, or null. */
  readonly activeProfile: string | null;
  /** Profiles by name. */
  readonly profiles: Readonly<Record<string, StoredProfile>>;
  /** Normalized project directory to profile name. */
  readonly projects: Readonly<Record<string, string>>;
}

/** Config with no profiles and no links. */
export const EMPTY_CONFIG: LibreDeskConfig = Object.freeze({ activeProfile: null, profiles: {}, projects: {} });

const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9-_]{0,62}$/;
const REPAIR_HINT = "delete it and run `ldesk login` again";

/** Directory holding the config file; `LIBREDESK_CONFIG_DIR` overrides the default in the home directory. */
export function getConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[ENV.CONFIG_DIR];
  return override ? resolve(override) : join(homedir(), DEFAULT_CONFIG_DIR_NAME);
}

/** Path of the config file. */
export function getConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(getConfigDir(env), "config.json");
}

function isStoredProfile(value: unknown): value is StoredProfile {
  return (
    isRecord(value) &&
    typeof value.url === "string" &&
    typeof value.apiKey === "string" &&
    typeof value.apiSecret === "string"
  );
}

function parseConfig(value: unknown, path: string): LibreDeskConfig {
  const fail = (why: string): never => {
    throw new ConfigError(`${path} is not a valid config: ${why}.`, {
      hint: `Repair ${path} by hand, or ${REPAIR_HINT}.`,
    });
  };
  if (!isRecord(value)) return fail("expected a JSON object");
  const { activeProfile = null, profiles = {}, projects = {} } = value;
  if (activeProfile !== null && typeof activeProfile !== "string") return fail('"activeProfile" must be a string or null');
  if (!isRecord(profiles) || !Object.values(profiles).every(isStoredProfile)) {
    return fail('"profiles" must map names to { url, apiKey, apiSecret }');
  }
  if (!isRecord(projects) || !Object.values(projects).every((v) => typeof v === "string")) {
    return fail('"projects" must map directories to profile names');
  }
  return {
    activeProfile,
    profiles: profiles as Record<string, StoredProfile>,
    projects: projects as Record<string, string>,
  };
}

/** Read the config file. A missing file yields {@link EMPTY_CONFIG}. */
export async function loadConfig(env: NodeJS.ProcessEnv = process.env): Promise<LibreDeskConfig> {
  const path = getConfigPath(env);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_CONFIG;
    throw new ConfigError(`Cannot read ${path}.`, { cause: err, hint: `Check the permissions of ${path}.` });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(`${path} is not valid JSON.`, {
      cause: err,
      hint: `Repair ${path} by hand, or ${REPAIR_HINT}.`,
    });
  }
  return parseConfig(parsed, path);
}

/** Write the config atomically (temp file, then rename) with mode 0600. */
export async function saveConfig(config: LibreDeskConfig, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const path = getConfigPath(env);
  const tmp = `${path}.tmp`;
  await mkdir(getConfigDir(env), { recursive: true });
  await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
}

/** Trim a base URL, strip trailing slashes and require http or https. Path prefixes are kept. */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    throw new ConfigError(`"${url}" is not a valid URL.`, { cause: err, hint: "Use a full URL such as https://desk.example.com." });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConfigError(`"${url}" must start with http:// or https://.`);
  }
  return trimmed;
}

/** Absolute path with forward slashes, no trailing slash and (on Windows) a lower-case drive letter. */
export function normalizeProjectPath(p: string): string {
  let out = resolve(p).replace(/\\/g, "/").replace(/\/+$/, "");
  if (process.platform === "win32") out = out.replace(/^[A-Za-z]:/, (drive) => drive.toLowerCase());
  return out;
}

/** Throw a {@link ConfigError} unless `name` is a safe profile name. */
export function assertValidProfileName(name: string): void {
  if (!PROFILE_NAME_RE.test(name)) {
    throw new ConfigError(`Profile name "${name}" must match ${PROFILE_NAME_RE.source}.`, {
      hint: "Use lower-case letters, digits, dash and underscore, starting with a letter or digit.",
    });
  }
}

/** Build the profile lookup failure for `name`, listing the known names. */
export function profileNotFound(config: LibreDeskConfig, name: string): ProfileNotFoundError {
  const known = Object.keys(config.profiles).join(", ") || "(none)";
  return new ProfileNotFoundError(`Profile "${name}" not found. Known profiles: ${known}.`, {
    hint: "Add one with `ldesk login`.",
  });
}

function assertKnown(config: LibreDeskConfig, name: string): void {
  if (config.profiles[name] === undefined) throw profileNotFound(config, name);
}

/** Add or replace a profile. The first profile added becomes the active one. */
export function upsertProfile(config: LibreDeskConfig, profile: Profile): LibreDeskConfig {
  assertValidProfileName(profile.name);
  const stored: StoredProfile = { url: normalizeUrl(profile.url), apiKey: profile.apiKey, apiSecret: profile.apiSecret };
  return {
    ...config,
    activeProfile: config.activeProfile ?? profile.name,
    profiles: { ...config.profiles, [profile.name]: stored },
  };
}

/** Remove a profile, clear it as active and drop project links pointing at it. */
export function removeProfile(config: LibreDeskConfig, name: string): LibreDeskConfig {
  assertKnown(config, name);
  const { [name]: _removed, ...profiles } = config.profiles;
  return {
    activeProfile: config.activeProfile === name ? null : config.activeProfile,
    profiles,
    projects: Object.fromEntries(Object.entries(config.projects).filter(([, linked]) => linked !== name)),
  };
}

/** Make a profile the active one. */
export function useProfile(config: LibreDeskConfig, name: string): LibreDeskConfig {
  assertKnown(config, name);
  return { ...config, activeProfile: name };
}

/** Link a directory to a profile, replacing any existing link for the same directory. */
export function linkProject(config: LibreDeskConfig, dir: string, name: string): LibreDeskConfig {
  assertKnown(config, name);
  return { ...config, projects: { ...config.projects, [normalizeProjectPath(dir)]: name } };
}

/** Remove the link for a directory. Unlinking a directory without a link changes nothing. */
export function unlinkProject(config: LibreDeskConfig, dir: string): LibreDeskConfig {
  const key = normalizeProjectPath(dir);
  return { ...config, projects: Object.fromEntries(Object.entries(config.projects).filter(([path]) => path !== key)) };
}
