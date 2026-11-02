/**
 * @module tests/mcp/helpers
 * A stand-in for `McpServer` that records tool registrations, and a temporary config dir with
 * stored profiles.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZodObject, type z } from "zod";
import { EMPTY_CONFIG, saveConfig, upsertProfile, type Profile } from "../../src/config.js";

/** One recorded `registerTool` call. */
export interface RecordedTool {
  readonly name: string;
  readonly description: string;
  readonly shape: z.ZodRawShape;
  readonly annotations: Record<string, unknown>;
  readonly handler: (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
}

/** A server that only records `registerTool` calls into `recorded`. */
export function recordingServer(recorded: RecordedTool[]): McpServer {
  return {
    registerTool: (
      name: string,
      config: { description: string; inputSchema: z.ZodRawShape | z.ZodObject; annotations?: Record<string, unknown> },
      handler: RecordedTool["handler"],
    ) => {
      const { inputSchema } = config;
      const shape = inputSchema instanceof ZodObject ? inputSchema.shape : inputSchema;
      recorded.push({ name, description: config.description, shape, annotations: config.annotations ?? {}, handler });
    },
  } as unknown as McpServer;
}

/** A profile named `name` with obviously fake credentials. */
export function fakeProfile(name: string): Profile {
  return { name, url: `https://${name}.example`, apiKey: `key-${name}-12345678`, apiSecret: `secret-${name}-12345678` };
}

/** Create a config dir holding the given profiles (the first one active); returns its env and a cleanup. */
export async function tempConfig(names: readonly string[]): Promise<{ env: NodeJS.ProcessEnv; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "ldesk-mcp-"));
  const env = { LIBREDESK_CONFIG_DIR: dir };
  const config = names.reduce((cfg, name) => upsertProfile(cfg, fakeProfile(name)), EMPTY_CONFIG);
  await saveConfig(config, env);
  return { env, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
