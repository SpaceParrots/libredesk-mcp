import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DOMAINS } from "../../src/domains/index.js";
import { defineDomain, defineOperation, type Domain } from "../../src/ops/define.js";
import { dispatchAction } from "../../src/mcp/action-tool.js";
import { ALL_UNDOCUMENTED, domainActions, registerDomainTool } from "../../src/mcp/domain-tool.js";
import { recordingServer, tempConfig, type RecordedTool } from "./helpers.js";

const whoami = defineOperation({
  name: "whoami",
  summary: "Say which profile runs.",
  method: "GET",
  path: "/api/v1/whoami",
  input: {},
  impact: "read",
  run: (_input, ctx) => Promise.resolve({ profile: ctx.profile.name, api_key: ctx.profile.apiKey }),
});

const save = defineOperation({
  name: "save",
  summary: "Save a thing.",
  method: "POST",
  path: "/api/v1/things",
  input: { title: z.string().describe("Title.") },
  impact: "write",
  run: (input) => Promise.resolve({ saved: input.title }),
});

const toggle = defineOperation({
  name: "toggle",
  summary: "Toggle a thing.",
  method: "PUT",
  path: "/api/v1/things/{id}/toggle",
  input: { id: z.number().describe("Id.") },
  impact: "caution",
  effect: "Takes it offline.",
  undocumented: true,
});

const remove = defineOperation({
  name: "delete",
  summary: "Delete a thing.",
  method: "DELETE",
  path: "/api/v1/things/{id}",
  input: { id: z.number().describe("Id.") },
  impact: "destructive",
  effect: "Deletes it.",
});

const hidden = defineOperation({
  name: "hidden",
  summary: "Not over MCP.",
  method: "GET",
  path: "/api/v1/hidden",
  input: {},
  impact: "read",
  mcp: false,
});

const things = defineDomain({
  name: "things",
  tool: "libredesk_things",
  toolset: "knowledge",
  summary: "Manage things.",
  operations: [whoami, save, toggle, remove, hidden],
});

function text(result: { content: { text: string }[] }): string {
  return result.content[0]?.text ?? "";
}

describe("domainActions", () => {
  it("marks destructive and caution actions in summaries", () => {
    const actions = domainActions(things);
    expect(actions.toggle?.summary).toBe("Toggle a thing. [undocumented] CAUTION: Takes it offline.");
    expect(actions.delete?.summary).toBe("Delete a thing. DESTRUCTIVE: Deletes it.");
    expect(actions.save?.summary).toBe("Save a thing.");
  });

  it("leaves out operations with mcp: false", () => {
    expect(Object.keys(domainActions(things))).toEqual(["whoami", "save", "toggle", "delete"]);
  });

  it("says undocumented once in the tool description when every action is", () => {
    const recorded: RecordedTool[] = [];
    const undocumented: Domain = { ...things, operations: [toggle, { ...remove, undocumented: true }] };
    registerDomainTool(recordingServer(recorded), undocumented);
    expect(recorded[0]?.description).toContain(`Manage things. ${ALL_UNDOCUMENTED}`);
    expect(recorded[0]?.description).not.toContain("[undocumented]");
    expect(recorded[0]?.description).toContain("- toggle(id): Toggle a thing. CAUTION: Takes it offline.");
  });
});

describe("registerDomainTool", () => {
  it("sets destructiveHint when a domain has a destructive op", () => {
    const recorded: RecordedTool[] = [];
    registerDomainTool(recordingServer(recorded), things);
    expect(recorded[0]?.annotations).toEqual({ readOnlyHint: false, destructiveHint: true });
  });

  it("sets readOnlyHint for a read-only domain", () => {
    const recorded: RecordedTool[] = [];
    const reads: Domain = { ...things, operations: [whoami] };
    registerDomainTool(recordingServer(recorded), reads);
    expect(recorded[0]?.annotations).toEqual({ readOnlyHint: true, destructiveHint: false });
  });

  it("registers a tool with action, merged fields and profile", () => {
    const recorded: RecordedTool[] = [];
    registerDomainTool(recordingServer(recorded), things);
    expect(recorded[0]?.name).toBe("libredesk_things");
    expect(Object.keys(recorded[0]?.shape ?? {})).toEqual(["action", "title", "id", "profile"]);
    expect(recorded[0]?.description).toContain("- delete(id): Delete a thing. DESTRUCTIVE: Deletes it.");
  });

  it("the merged schema does not fill in another action's defaults", async () => {
    const recorded: RecordedTool[] = [];
    const articles = DOMAINS.find((d) => d.tool === "libredesk_articles") as Domain;
    registerDomainTool(recordingServer(recorded), articles);
    const parsed = z.object(recorded[0]?.shape ?? {}).parse({ action: "list", help_center_id: 1 });
    expect(parsed).toEqual({ action: "list", help_center_id: 1 });
    const run = vi.fn().mockResolvedValue([]);
    const res = await dispatchAction(domainActions(articles, run), parsed);
    expect(res.isError).toBeUndefined();
  });
});

describe("domain tool calls", () => {
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const config = await tempConfig(["prod", "staging"]);
    cleanup = config.cleanup;
    vi.stubEnv("LIBREDESK_URL", "");
    vi.stubEnv("LIBREDESK_API_KEY", "");
    vi.stubEnv("LIBREDESK_API_SECRET", "");
    vi.stubEnv("LIBREDESK_PROFILE", "");
    vi.stubEnv("LIBREDESK_CONFIG_DIR", config.env.LIBREDESK_CONFIG_DIR);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanup();
  });

  it("returns a validation error naming the field for a missing required arg", async () => {
    const res = await dispatchAction(domainActions(things), { action: "save" });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/title/);
  });

  it("masks secrets in tool results", async () => {
    const res = await dispatchAction(domainActions(things), { action: "whoami" });
    expect(res.isError).toBeUndefined();
    expect(text(res)).toBe('{"profile":"prod","api_key":"••••5678"}');
    expect(text(res)).not.toContain("key-prod");
  });

  it("runs inside withProfile when profile is passed", async () => {
    const res = await dispatchAction(domainActions(things), { action: "whoami", profile: "staging" });
    expect(JSON.parse(text(res))).toMatchObject({ profile: "staging" });
  });

  it("passes the validated input to the operation runner", async () => {
    const run = vi.fn().mockResolvedValue({ ok: true });
    const res = await dispatchAction(domainActions(things, run), { action: "save", title: "T" });
    expect(text(res)).toBe('{"ok":true}');
    expect(run).toHaveBeenCalledWith(save, { title: "T" });
  });

  it("returns the hint to log in when no profile is configured", async () => {
    const empty = await tempConfig([]);
    vi.stubEnv("LIBREDESK_CONFIG_DIR", empty.env.LIBREDESK_CONFIG_DIR);
    try {
      const res = await dispatchAction(domainActions(things), { action: "whoami" });
      expect(res.isError).toBe(true);
      expect(text(res)).toContain("No LibreDesk profile configured.");
      expect(text(res)).toContain("Hint: Run `ldesk login`");
    } finally {
      await empty.cleanup();
    }
  });
});
