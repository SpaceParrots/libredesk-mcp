/**
 * @module services/mcp-config
 * Pure builders for `ldesk mcp install`: the server entry, and merging it into an existing
 * `.mcp.json` without disturbing other servers or unknown keys. No file access here.
 */

import type { Profile } from "../config.js";
import { ENV, PACKAGE_NAME } from "../constants.js";
import { ConfigError } from "../errors.js";
import { isRecord } from "../guards.js";

/** The `mcpServers.<name>` entry. */
export interface McpServerEntry {
  readonly command: string;
  readonly args: string[];
  readonly env: Record<string, string>;
}

/** Choices for {@link buildServerEntry}. */
export interface ServerEntryOptions {
  /** `profile` pins a stored profile by name; `env` copies the credentials into the entry. */
  readonly mode: "profile" | "env";
  readonly profileName?: string;
  /** Required for mode `env`. */
  readonly profile?: Profile;
  /** Run through `npx -y` instead of a global `ldesk`. */
  readonly useNpx: boolean;
  /** Comma separated toolsets. */
  readonly toolsets?: string;
}

/** Build the MCP server entry. */
export function buildServerEntry(opts: ServerEntryOptions): McpServerEntry {
  const base = opts.useNpx
    ? { command: "npx", args: ["-y", PACKAGE_NAME, "serve"] }
    : { command: "ldesk", args: ["serve"] };
  const env: Record<string, string> = {};
  if (opts.mode === "env") {
    if (opts.profile === undefined) throw new ConfigError("Mode env needs a profile to copy credentials from.");
    env[ENV.URL] = opts.profile.url;
    env[ENV.API_KEY] = opts.profile.apiKey;
    env[ENV.API_SECRET] = opts.profile.apiSecret;
  } else if (opts.profileName !== undefined) {
    env[ENV.PROFILE] = opts.profileName;
  }
  if (opts.toolsets) env[ENV.TOOLSETS] = opts.toolsets;
  return { ...base, env };
}

const FIX_HINT = "Fix or delete the file, then run `ldesk mcp install` again.";

function parseRoot(text: string): Record<string, unknown> {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new ConfigError(".mcp.json exists but is not valid JSON.", { hint: FIX_HINT });
  }
  if (!isRecord(root)) throw new ConfigError(".mcp.json must contain a JSON object at the root.", { hint: FIX_HINT });
  return root;
}

/**
 * Merge `entry` as `mcpServers.<serverName>` into an existing `.mcp.json` document (or start a
 * new one). Other servers and unknown root keys are kept. Returns pretty JSON with a trailing newline.
 */
export function mergeMcpJson(existingText: string | undefined, serverName: string, entry: McpServerEntry): string {
  const root = existingText?.trim() ? parseRoot(existingText) : {};
  const servers = isRecord(root.mcpServers) ? root.mcpServers : {};
  return `${JSON.stringify({ ...root, mcpServers: { ...servers, [serverName]: entry } }, null, 2)}\n`;
}
