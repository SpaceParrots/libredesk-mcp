import { describe, expect, it } from "vitest";
import { z } from "zod";
import { registerTools } from "../../src/mcp/server.js";
import { recordingServer, type RecordedTool } from "./helpers.js";

/**
 * Approximates the always-on context cost of the registered tools: tool names, descriptions and
 * every parameter name and description (the vex method; JSON schema scaffolding adds a roughly
 * constant factor on top).
 */
function measure(recorded: readonly RecordedTool[]): number {
  return recorded.reduce((sum, tool) => {
    const params = Object.entries(tool.shape).reduce((s, [key, schema]) => s + key.length + (z.globalRegistry.get(schema)?.description?.length ?? 0), 0);
    return sum + tool.name.length + tool.description.length + params;
  }, 0);
}

// Measured 2026-11-02: default toolsets 8288 chars (14515 before trimming descriptions; 8177 before the
// articles create escalation note). CLI-only help (`Operation.cli`) is not part of the tool surface.
// Ceiling: measured * 1.1 rounded up to the next 500, capped at the hard bound.
const DEFAULT_CEILING = 9_000;
const HARD_BOUND = 9_000;

describe("MCP tool-definition token budget", () => {
  it(`default toolsets stay under ${DEFAULT_CEILING} chars`, () => {
    const recorded: RecordedTool[] = [];
    registerTools(recordingServer(recorded), {});
    const size = measure(recorded);
    expect(size, `default tool surface is ${size} chars`).toBeLessThanOrEqual(DEFAULT_CEILING);
    expect(DEFAULT_CEILING).toBeLessThanOrEqual(HARD_BOUND);
  });
});
