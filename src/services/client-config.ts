/**
 * @module services/client-config
 * Finds the LibreDesk server entries an MCP client starts: Claude Code's `~/.claude.json` (user
 * scope at the top level, local scope under `projects[<cwd>]`) and `./.mcp.json` (project scope).
 * Files are read defensively: a missing or broken file is reported, never thrown. Entries keep
 * their env values because launching needs them; nothing meant for printing may include them.
 */

import { readFile } from "node:fs/promises";
import { posix, win32 } from "node:path";
import { isRecord } from "../guards.js";

/** Claude Code's config scopes, highest precedence first. */
export type EntryScope = "local" | "project" | "user";

const PRECEDENCE: readonly EntryScope[] = ["local", "project", "user"];

/** Name Claude Code and `ldesk mcp install` use for the server. */
export const DEFAULT_SERVER_NAME = "libredesk";

/** One stdio server entry the client would start. */
export interface ClientEntry {
  readonly name: string;
  readonly scope: EntryScope;
  readonly file: string;
  readonly command: string;
  readonly args: readonly string[];
  /** Values may be secrets: use them to launch, never to print. */
  readonly env: Readonly<Record<string, string>>;
}

/** What reading one config file found. */
export interface ConfigFileReport {
  readonly file: string;
  readonly state: "found" | "missing" | "invalid";
  /** Why the file is invalid. Never contains file content. */
  readonly problem?: string;
  /** Matching entries, as `<name> (<scope>)`. */
  readonly matched: readonly string[];
  /** Matching entries that are not stdio servers (url based), so they cannot be launched. */
  readonly notStdio: readonly string[];
}

/** Every config file looked at, and the entries the client would use. */
export interface ClientConfigs {
  readonly files: readonly ConfigFileReport[];
  /** One per server name, the one with the highest scope precedence. */
  readonly entries: readonly ClientEntry[];
}

/** Inputs of {@link discoverClientConfigs}. */
export interface DiscoverOptions {
  readonly homeDir: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  /** The running `ldesk` script, so an entry that points at it by path matches too. */
  readonly scriptPath: string;
  /** Reads a file as text; `undefined` when it does not exist. */
  readonly readText?: (path: string) => Promise<string | undefined>;
}

/** Read a file, `undefined` when it does not exist. Other errors throw. */
export async function readTextIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Path of Claude Code's config file: `$CLAUDE_CONFIG_DIR/.claude.json`, else `~/.claude.json`. */
export function claudeConfigPath(homeDir: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  const path = platform === "win32" ? win32 : posix;
  return path.join(env.CLAUDE_CONFIG_DIR || homeDir, ".claude.json");
}

function comparablePath(p: string, platform: NodeJS.Platform): string {
  const slashed = p.replaceAll("\\", "/").replace(/\/+$/, "");
  return platform === "win32" ? slashed.toLowerCase() : slashed;
}

function baseName(token: string): string {
  const last = token.split(/[\\/]/).pop() ?? token;
  return last.toLowerCase().replace(/\.(cmd|exe|ps1|bat|js|mjs)$/, "");
}

/** True when an entry looks like this package: by name, by the `ldesk` binary, the package name, or the running script. */
export function isLibreDeskEntry(name: string, command: string, args: readonly string[], scriptPath: string, platform: NodeJS.Platform): boolean {
  if (name.toLowerCase() === DEFAULT_SERVER_NAME) return true;
  const script = scriptPath === "" ? undefined : comparablePath(scriptPath, platform);
  return [command, ...args].some(
    (token) => baseName(token) === "ldesk" || token.toLowerCase().includes("libredesk-mcp") || (script !== undefined && comparablePath(token, platform) === script),
  );
}

interface ParsedServers {
  readonly entries: ClientEntry[];
  readonly matched: string[];
  readonly notStdio: string[];
}

function parseServers(servers: unknown, scope: EntryScope, file: string, options: DiscoverOptions): ParsedServers {
  const out: ParsedServers = { entries: [], matched: [], notStdio: [] };
  if (!isRecord(servers)) return out;
  for (const [name, raw] of Object.entries(servers)) {
    if (!isRecord(raw)) continue;
    const command = typeof raw.command === "string" ? raw.command : "";
    const args = Array.isArray(raw.args) ? raw.args.filter((a): a is string => typeof a === "string") : [];
    if (!isLibreDeskEntry(name, command, args, options.scriptPath, options.platform)) continue;
    out.matched.push(`${name} (${scope})`);
    if (command === "" || (raw.type !== undefined && raw.type !== "stdio")) {
      out.notStdio.push(name);
      continue;
    }
    const env = isRecord(raw.env)
      ? Object.fromEntries(Object.entries(raw.env).filter((pair): pair is [string, string] => typeof pair[1] === "string"))
      : {};
    out.entries.push({ name, scope, file, command, args, env });
  }
  return out;
}

async function readJson(file: string, read: (path: string) => Promise<string | undefined>): Promise<{ root?: Record<string, unknown>; report?: ConfigFileReport }> {
  const empty = { file, matched: [], notStdio: [] };
  let text: string | undefined;
  try {
    text = await read(file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "unknown error";
    return { report: { ...empty, state: "invalid", problem: `could not be read (${code})` } };
  }
  if (text === undefined) return { report: { ...empty, state: "missing" } };
  let root: unknown;
  try {
    root = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return { report: { ...empty, state: "invalid", problem: "is not valid JSON" } };
  }
  if (!isRecord(root)) return { report: { ...empty, state: "invalid", problem: "has no JSON object at the root" } };
  return { root };
}

function projectServers(root: Record<string, unknown>, cwd: string, platform: NodeJS.Platform): unknown {
  if (!isRecord(root.projects)) return undefined;
  const wanted = comparablePath(cwd, platform);
  const key = Object.keys(root.projects).find((k) => comparablePath(k, platform) === wanted);
  const project = key === undefined ? undefined : root.projects[key];
  return isRecord(project) ? project.mcpServers : undefined;
}

/**
 * Read `~/.claude.json` and `./.mcp.json` and return the matching entries. When the same name
 * appears in several scopes only the one Claude Code uses is returned: local, then project, then user.
 */
export async function discoverClientConfigs(options: DiscoverOptions): Promise<ClientConfigs> {
  const read = options.readText ?? readTextIfExists;
  const path = options.platform === "win32" ? win32 : posix;
  const claudeFile = claudeConfigPath(options.homeDir, options.env, options.platform);
  const projectFile = path.join(options.cwd, ".mcp.json");
  const files: ConfigFileReport[] = [];
  const found: ClientEntry[] = [];

  const claude = await readJson(claudeFile, read);
  if (claude.root === undefined) {
    if (claude.report) files.push(claude.report);
  } else {
    const user = parseServers(claude.root.mcpServers, "user", claudeFile, options);
    const local = parseServers(projectServers(claude.root, options.cwd, options.platform), "local", claudeFile, options);
    files.push({ file: claudeFile, state: "found", matched: [...user.matched, ...local.matched], notStdio: [...user.notStdio, ...local.notStdio] });
    found.push(...user.entries, ...local.entries);
  }

  const project = await readJson(projectFile, read);
  if (project.root === undefined) {
    if (project.report) files.push(project.report);
  } else {
    const parsed = parseServers(project.root.mcpServers, "project", projectFile, options);
    files.push({ file: projectFile, state: "found", matched: parsed.matched, notStdio: parsed.notStdio });
    found.push(...parsed.entries);
  }

  const rank = (entry: ClientEntry) => PRECEDENCE.indexOf(entry.scope);
  const entries = [...found]
    .sort((a, b) => rank(a) - rank(b))
    .filter((entry, index, all) => all.findIndex((other) => other.name === entry.name) === index);
  return { files, entries };
}
