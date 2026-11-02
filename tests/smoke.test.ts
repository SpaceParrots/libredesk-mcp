import { describe, it, expect } from "vitest";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LIBREDESK_TARGET_VERSION } from "../src/constants.js";

describe("smoke", () => {
  it("pins the target LibreDesk version", () => {
    expect(LIBREDESK_TARGET_VERSION).toBe("2.9.2");
  });
  it("MCP SDK accepts a zod 4 shape", () => {
    const server = new McpServer({ name: "t", version: "0.0.0" });
    expect(() =>
      server.registerTool("t", { description: "d", inputSchema: { a: z.string().describe("x") } }, async () => ({ content: [] })),
    ).not.toThrow();
  });
});
