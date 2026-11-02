/**
 * @module tests/live/mcp.live.test
 * End-to-end check of the built MCP server: spawns `node dist/index.js serve` over stdio, lists the
 * tools and drives help centers through them against a local LibreDesk. Run `npm run build` first.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { liveProfile, uniqueName, writesAllowed } from "./helpers.js";

const ENTRY = resolve("dist/index.js");
const TOOLS = [
  "libredesk_help_center",
  "libredesk_articles",
  "libredesk_ai_knowledge",
  "libredesk_lookup",
  "libredesk_request",
  "libredesk_status",
];

interface TextResult {
  readonly content: readonly { readonly type: string; readonly text?: string }[];
  readonly isError?: boolean;
}

function textOf(result: unknown): string {
  return (result as TextResult).content.map((c) => c.text ?? "").join("\n");
}

/** The process env as strings, with an empty config dir so only the LIBREDESK_* credentials count. */
function serverEnv(configDir: string): Record<string, string> {
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));
  return { ...env, LIBREDESK_CONFIG_DIR: configDir };
}

describe.skipIf(!liveProfile())("MCP server over stdio against local LibreDesk", () => {
  const configDir = mkdtempSync(join(tmpdir(), "ldesk-mcp-live-"));
  const client = new Client({ name: "ldesk-live-test", version: "0.0.0" });
  let helpCenterId: number | undefined;

  beforeAll(async () => {
    if (!existsSync(ENTRY)) throw new Error("dist/index.js is missing: run `npm run build` first.");
    const transport = new StdioClientTransport({ command: process.execPath, args: [ENTRY, "serve"], env: serverEnv(configDir), stderr: "pipe" });
    await client.connect(transport);
  });

  afterAll(async () => {
    if (helpCenterId !== undefined) {
      await client.callTool({ name: "libredesk_help_center", arguments: { action: "delete", id: helpCenterId } }).catch(() => undefined);
    }
    await client.close();
    rmSync(configDir, { recursive: true, force: true });
  });

  it("lists the phase 1 tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(TOOLS);
  });

  it("reports status for the env profile", async () => {
    const result = await client.callTool({ name: "libredesk_status", arguments: {} });
    expect(result.isError).toBeFalsy();
    const report = JSON.parse(textOf(result)) as Record<string, unknown>;
    expect(report).toMatchObject({ profile: "env", source: "env", reachable: true });
    expect(textOf(result)).not.toContain(liveProfile()?.apiSecret ?? "<none>");
  });

  it("lists help centers", async () => {
    const result = await client.callTool({ name: "libredesk_help_center", arguments: { action: "list" } });
    expect(result.isError).toBeFalsy();
    expect(Array.isArray(JSON.parse(textOf(result)))).toBe(true);
  });

  it("rejects a field of another action with a readable error", async () => {
    const result = await client.callTool({ name: "libredesk_help_center", arguments: { action: "list", id: 1 } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("id: not a field of this action");
  });

  it.skipIf(!writesAllowed())("creates and deletes a throwaway help center", async () => {
    const name = uniqueName("mcp");
    const created = await client.callTool({
      name: "libredesk_help_center",
      arguments: { action: "create", name, slug: name.toLowerCase(), page_title: name },
    });
    expect(created.isError, textOf(created)).toBeFalsy();
    helpCenterId = (JSON.parse(textOf(created)) as { id: number }).id;

    const listed = await client.callTool({ name: "libredesk_help_center", arguments: { action: "list" } });
    expect((JSON.parse(textOf(listed)) as { id: number }[]).map((hc) => hc.id)).toContain(helpCenterId);

    const deleted = await client.callTool({ name: "libredesk_help_center", arguments: { action: "delete", id: helpCenterId } });
    expect(deleted.isError, textOf(deleted)).toBeFalsy();
    const id = helpCenterId;
    helpCenterId = undefined;

    const after = await client.callTool({ name: "libredesk_help_center", arguments: { action: "list" } });
    expect((JSON.parse(textOf(after)) as { id: number }[]).map((hc) => hc.id)).not.toContain(id);
  });

  it("refuses a raw DELETE without confirm", async () => {
    const result = await client.callTool({
      name: "libredesk_request",
      arguments: { action: "call", method: "DELETE", path: "/api/v1/help-centers/999999" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("confirm: true");
  });
});
