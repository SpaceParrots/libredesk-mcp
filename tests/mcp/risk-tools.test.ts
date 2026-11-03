import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DOMAINS } from "../../src/domains/index.js";
import { dispatchAction } from "../../src/mcp/action-tool.js";
import { ALL_UNDOCUMENTED } from "../../src/mcp/domain-tool.js";
import { registerRiskTools, riskActions } from "../../src/mcp/risk-tools.js";
import { defineDomain, defineOperation, type Domain } from "../../src/ops/define.js";
import { recordingServer, type RecordedTool } from "./helpers.js";

const toggle = defineOperation({
  name: "toggle",
  summary: "Take a thing offline.",
  method: "PUT",
  path: "/api/v1/things/{id}/toggle",
  input: { id: z.number().describe("Id.") },
  impact: "caution",
  effect: "Changes what the public sees.",
});

const remove = defineOperation({
  name: "delete",
  summary: "Delete a thing.",
  method: "DELETE",
  path: "/api/v1/things/{id}",
  input: { id: z.number().describe("Id.") },
  impact: "destructive",
  effect: "Gone for good.",
});

const partDelete = defineOperation({ ...remove, name: "part_delete", group: "part", summary: "Delete a part." });

const switchOn = defineOperation({
  name: "switch",
  summary: "Switch billing.",
  method: "PUT",
  path: "/api/v1/switch",
  input: { enabled: z.boolean().describe("On or off.") },
  impact: "write",
  escalate: { when: (values) => values.enabled === true, condition: "enabled is true", impact: "caution", effect: "Costs money." },
  mcpTool: "publish",
});

const things = defineDomain({
  name: "things",
  tool: "libredesk_things",
  actionPrefix: "thing",
  toolset: "knowledge",
  summary: "Manage things.",
  groups: { part: "Parts of things." },
  operations: [toggle, remove, partDelete, switchOn],
});

describe("riskActions", () => {
  it("prefixes ungrouped names with the domain and keeps grouped ones", () => {
    expect(Object.keys(riskActions([things], "publish"))).toEqual(["thing_toggle", "thing_switch"]);
    expect(Object.keys(riskActions([things], "delete"))).toEqual(["thing_delete", "part_delete"]);
  });

  it("states the effect, and an escalation's condition, without a risk label", () => {
    const actions = riskActions([things], "publish");
    expect(actions.thing_toggle?.summary).toBe("Take a thing offline. Changes what the public sees.");
    expect(actions.thing_switch?.summary).toBe("Switch billing. When enabled is true: Costs money.");
  });

  it("throws on two domains giving the same action name", () => {
    const twin: Domain = { ...things, name: "twins", tool: "libredesk_twins" };
    expect(() => riskActions([things, twin], "delete")).toThrow(/duplicate action thing_delete/);
  });

  it("leaves out operations with mcp: false", () => {
    const hidden: Domain = { ...things, operations: [{ ...toggle, mcp: false }] };
    expect(riskActions([hidden], "publish")).toEqual({});
  });

  it("runs the operation with the action's own validated fields", async () => {
    const run = vi.fn().mockResolvedValue({ ok: true });
    const res = await dispatchAction(riskActions([things], "delete", run), { action: "thing_delete", id: 3 });
    expect(res.isError).toBeUndefined();
    expect(run).toHaveBeenCalledWith(remove, { id: 3 }, { caller: "mcp" });
  });
});

describe("registerRiskTools", () => {
  it("registers libredesk_publish and libredesk_delete with their hints", () => {
    const recorded: RecordedTool[] = [];
    registerRiskTools(recordingServer(recorded), [things]);
    expect(recorded.map((tool) => [tool.name, tool.annotations])).toEqual([
      ["libredesk_publish", { readOnlyHint: false, destructiveHint: true, idempotentHint: false }],
      ["libredesk_delete", { readOnlyHint: false, destructiveHint: true, idempotentHint: true }],
    ]);
  });

  it("registers no tool for a tier without actions", () => {
    const recorded: RecordedTool[] = [];
    registerRiskTools(recordingServer(recorded), [{ ...things, operations: [remove] }]);
    expect(recorded.map((tool) => tool.name)).toEqual(["libredesk_delete"]);
  });

  it("holds every publishing and deleting action of the real domains", () => {
    const recorded: RecordedTool[] = [];
    registerRiskTools(recordingServer(recorded), DOMAINS);
    const actions = (name: string) => (recorded.find((tool) => tool.name === name)?.shape.action as z.ZodEnum).options;
    expect(actions("libredesk_publish")).toEqual(["help_center_toggle", "collection_publish", "collection_move", "article_set_status", "article_move", "learning_set"]);
    expect(actions("libredesk_delete")).toEqual(["help_center_delete", "collection_delete", "article_delete", "snippet_delete"]);
    expect(recorded[0]?.description).toContain(ALL_UNDOCUMENTED);
  });
});
