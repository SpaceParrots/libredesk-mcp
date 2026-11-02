import { describe, expect, it } from "vitest";
import { ConfigError } from "../../src/errors.js";
import { buildServerEntry, mergeMcpJson } from "../../src/services/mcp-config.js";

const profile = { name: "prod", url: "https://desk.example", apiKey: "k", apiSecret: "s" };

describe("buildServerEntry", () => {
  it("with npx and profile mode", () => {
    expect(buildServerEntry({ mode: "profile", profileName: "prod", useNpx: true })).toEqual({
      command: "npx",
      args: ["-y", "@spaceparrots/libredesk-mcp", "serve"],
      env: { LIBREDESK_PROFILE: "prod" },
    });
  });
  it("global binary, env mode and toolsets", () => {
    expect(buildServerEntry({ mode: "env", profile, useNpx: false, toolsets: "articles,lookup" })).toEqual({
      command: "ldesk",
      args: ["serve"],
      env: {
        LIBREDESK_URL: "https://desk.example",
        LIBREDESK_API_KEY: "k",
        LIBREDESK_API_SECRET: "s",
        LIBREDESK_TOOLSETS: "articles,lookup",
      },
    });
  });
  it("profile mode without a name sets no profile", () => {
    expect(buildServerEntry({ mode: "profile", useNpx: false }).env).toEqual({});
  });
  it("env mode without a profile fails", () => {
    expect(() => buildServerEntry({ mode: "env", useNpx: false })).toThrow(ConfigError);
  });
});

describe("mergeMcpJson", () => {
  const entry = buildServerEntry({ mode: "profile", profileName: "prod", useNpx: false });

  it("creates a fresh document with a trailing newline", () => {
    const out = mergeMcpJson(undefined, "libredesk", entry);
    expect(JSON.parse(out)).toEqual({ mcpServers: { libredesk: entry } });
    expect(out.endsWith("\n")).toBe(true);
  });
  it("keeps other servers and unknown keys, and replaces its own entry", () => {
    const existing = JSON.stringify({ $schema: "x", mcpServers: { other: { command: "o" }, libredesk: { command: "old" } } });
    const parsed = JSON.parse(mergeMcpJson(existing, "libredesk", entry)) as { $schema: string; mcpServers: Record<string, { command?: string }> };
    expect(parsed.$schema).toBe("x");
    expect(parsed.mcpServers.other).toEqual({ command: "o" });
    expect(parsed.mcpServers.libredesk.command).toBe("ldesk");
  });
  it("rejects invalid JSON and non-object roots", () => {
    expect(() => mergeMcpJson("{ no", "libredesk", entry)).toThrow(ConfigError);
    expect(() => mergeMcpJson("[]", "libredesk", entry)).toThrow(ConfigError);
  });
});
