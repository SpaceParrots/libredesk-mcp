import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DOMAINS } from "../../src/domains/index.js";
import { ConfigError } from "../../src/errors.js";
import { SERVER_INSTRUCTIONS } from "../../src/mcp/instructions.js";
import { createMcpServer, parseToolsets, registerTools, selectDomains } from "../../src/mcp/server.js";
import { statusResult } from "../../src/mcp/status-tool.js";
import { recordingServer, tempConfig, type RecordedTool } from "./helpers.js";

const PHASE_1_TOOLS = [
  "libredesk_help_center",
  "libredesk_articles",
  "libredesk_ai_knowledge",
  "libredesk_lookup",
  "libredesk_request",
  "libredesk_status",
];

function toolNames(env: NodeJS.ProcessEnv): string[] {
  const recorded: RecordedTool[] = [];
  registerTools(recordingServer(recorded), env);
  return recorded.map((t) => t.name);
}

describe("toolsets", () => {
  it("default toolsets register exactly the phase 1 tools", () => {
    expect(toolNames({})).toEqual(PHASE_1_TOOLS);
    expect(toolNames({ LIBREDESK_TOOLSETS: "" })).toEqual(PHASE_1_TOOLS);
  });

  it("LIBREDESK_TOOLSETS=knowledge still includes core tools", () => {
    expect(toolNames({ LIBREDESK_TOOLSETS: "knowledge" })).toEqual(PHASE_1_TOOLS);
    expect(toolNames({ LIBREDESK_TOOLSETS: "support" })).toEqual(["libredesk_lookup", "libredesk_request", "libredesk_status"]);
  });

  it("unknown toolset fails listing valid ones", () => {
    expect(() => parseToolsets("knowledge, bogus")).toThrow(ConfigError);
    try {
      parseToolsets("bogus");
    } catch (error) {
      expect((error as ConfigError).message).toContain('"bogus"');
      expect((error as ConfigError).hint).toContain("knowledge");
    }
  });

  it("parses all, case and spaces", () => {
    expect(parseToolsets(" ALL ")).toBe("all");
    expect(parseToolsets("Knowledge , ai")).toEqual(new Set(["knowledge", "ai"]));
    expect(parseToolsets(undefined)).not.toContain("support");
  });

  it("selectDomains keeps core and the selected toolsets", () => {
    expect(selectDomains(DOMAINS, new Set()).map((d) => d.name)).toEqual(["lookup"]);
    expect(selectDomains(DOMAINS, "all")).toHaveLength(DOMAINS.length);
  });
});

describe("instructions", () => {
  it("fit in 25 lines and name the tools they point to", () => {
    expect(SERVER_INSTRUCTIONS.split("\n").length).toBeLessThanOrEqual(25);
    for (const name of ["libredesk_status", "libredesk_lookup", "libredesk_request", "ai_enabled", "published", "markdown"]) {
      expect(SERVER_INSTRUCTIONS).toContain(name);
    }
  });
});

describe("libredesk_status", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns the masked status of the env profile", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "success", data: { email: "a@b.c" } })));
    const res = await statusResult(undefined, {
      fetchImpl,
      env: { LIBREDESK_URL: "https://desk.example", LIBREDESK_API_KEY: "key-12345678", LIBREDESK_API_SECRET: "secret-12345678" },
    });
    const report = JSON.parse(res.content[0]?.text ?? "") as Record<string, unknown>;
    expect(report).toMatchObject({ profile: "env", source: "env", reachable: true, agent: "a@b.c", apiKey: "••••5678" });
    expect(res.content[0]?.text).not.toContain("secret-12345678");
  });

  it("returns the login hint when no profile is configured", async () => {
    const empty = await tempConfig([]);
    try {
      const res = await statusResult(undefined, { env: empty.env });
      expect(res.isError).toBe(true);
      expect(res.content[0]?.text).toContain("Hint: Run `ldesk login`");
    } finally {
      await empty.cleanup();
    }
  });
});

describe("MCP server over a transport", () => {
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const empty = await tempConfig([]);
    cleanup = empty.cleanup;
    for (const name of ["LIBREDESK_URL", "LIBREDESK_API_KEY", "LIBREDESK_API_SECRET", "LIBREDESK_PROFILE"]) vi.stubEnv(name, "");
    vi.stubEnv("LIBREDESK_CONFIG_DIR", empty.env.LIBREDESK_CONFIG_DIR);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanup();
  });

  it("starts without a profile, lists the tools with instructions and answers calls with the login hint", async () => {
    const server = createMcpServer({});
    const client = new Client({ name: "test", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(PHASE_1_TOOLS);
      const articles = tools.find((t) => t.name === "libredesk_articles");
      expect(articles?.annotations).toMatchObject({ destructiveHint: true, readOnlyHint: false });
      expect(articles?.inputSchema.required).toEqual(["action"]);

      const res = await client.callTool({ name: "libredesk_help_center", arguments: { action: "list" } });
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.content)).toContain("ldesk login");

      const typo = await client.callTool({ name: "libredesk_help_center", arguments: { action: "get", id: 1, titel: "x" } });
      expect(typo.isError).toBe(true);
      expect(JSON.stringify(typo.content)).toContain("titel: not a field of this action");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
