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
  actionPrefix: "thing",
  toolset: "knowledge",
  summary: "Manage things.",
  operations: [whoami, save, toggle, remove, hidden],
});

function text(result: { content: { text: string }[] }): string {
  return result.content[0]?.text ?? "";
}

describe("domainActions", () => {
  it("leaves caution and destructive operations to the shared tools", () => {
    const actions = domainActions(things);
    expect(Object.keys(actions)).toEqual(["whoami", "save"]);
    expect(actions.save?.summary).toBe("Save a thing.");
  });

  it("leaves a write operation with mcpTool to its shared tool", () => {
    const paid = defineOperation({ ...save, name: "paid", mcpTool: "publish" });
    expect(Object.keys(domainActions({ ...things, operations: [save, paid] }))).toEqual(["save"]);
  });

  it("leaves the escalating fields out of the action, so it cannot take the risky path", async () => {
    const publish = defineOperation({
      name: "publish",
      summary: "Save a thing.",
      method: "POST",
      path: "/api/v1/things",
      impact: "write",
      input: { title: z.string().describe("Title."), status: z.enum(["draft", "published"]).default("draft").describe("Status.") },
      escalate: { when: (values) => values.status === "published", condition: "status is published", impact: "caution", effect: "Goes public.", fields: ["status"] },
    });
    const actions = domainActions({ ...things, operations: [publish] });
    expect(Object.keys(actions.publish?.shape ?? {})).toEqual(["title"]);
    expect(actions.publish?.summary).toBe("Save a thing.");
    const res = await dispatchAction(actions, { action: "publish", title: "T", status: "published" });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("status: not a field of this action");
  });

  it("notes an escalation in the summary, and never the CLI help", () => {
    const publish = defineOperation({
      ...save,
      name: "publish",
      input: { title: z.string().describe("Title."), status: z.enum(["draft", "published"]).optional().describe("Status.") },
      escalate: { when: (values) => values.status === "published", condition: "status is published", impact: "caution", effect: "Goes public." },
      cli: { examples: ["ldesk things publish --title T"], notes: ["A CLI-only note."] },
    });
    const summary = domainActions({ ...things, operations: [publish] }).publish?.summary;
    expect(summary).toBe("Save a thing. CAUTION when status is published: Goes public.");
    const recorded: RecordedTool[] = [];
    registerDomainTool(recordingServer(recorded), { ...things, operations: [publish] });
    expect(JSON.stringify(recorded[0]?.description)).not.toContain("CLI-only");
    expect(JSON.stringify(recorded[0]?.description)).not.toContain("ldesk things");
  });

  it("leaves out operations with mcp: false", () => {
    expect(Object.keys(domainActions({ ...things, operations: [whoami, hidden] }))).toEqual(["whoami"]);
  });

  it("says undocumented once in the tool description when every action is", () => {
    const recorded: RecordedTool[] = [];
    const undocumented: Domain = { ...things, operations: [{ ...whoami, undocumented: true }, { ...save, undocumented: true }, toggle] };
    registerDomainTool(recordingServer(recorded), undocumented);
    expect(recorded[0]?.description).toContain(`Manage things. ${ALL_UNDOCUMENTED}`);
    expect(recorded[0]?.description).not.toContain("[undocumented]");
    expect(recorded[0]?.description).toContain("- save(title): Save a thing.");
  });
});

describe("registerDomainTool", () => {
  it("never sets destructiveHint, since deletes are in libredesk_delete", () => {
    const recorded: RecordedTool[] = [];
    registerDomainTool(recordingServer(recorded), things);
    expect(recorded[0]?.annotations).toEqual({ readOnlyHint: false, destructiveHint: false });
  });

  it("registers nothing when every operation went to a shared tool", () => {
    const recorded: RecordedTool[] = [];
    registerDomainTool(recordingServer(recorded), { ...things, operations: [toggle, remove] });
    expect(recorded).toEqual([]);
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
    expect(Object.keys(recorded[0]?.shape ?? {})).toEqual(["action", "title", "profile"]);
    expect(recorded[0]?.description).not.toContain("delete");
  });

  it("leads a merged field description with the actions that require the field", () => {
    const recorded: RecordedTool[] = [];
    const articles = DOMAINS.find((d) => d.tool === "libredesk_articles") as Domain;
    registerDomainTool(recordingServer(recorded), articles);
    const field = recorded[0]?.shape.collection_id as z.core.$ZodType;
    expect(z.globalRegistry.get(field)?.description).toBe(
      "Collection id. For move: Target collection id. For list: Only this collection.",
    );
  });

  it("applies each action's own defaults through the real articles tool", async () => {
    const articles = DOMAINS.find((d) => d.tool === "libredesk_articles") as Domain;
    const run = vi.fn().mockResolvedValue({});
    const actions = domainActions(articles, run);
    await dispatchAction(actions, { action: "get", id: 7 });
    expect(run.mock.calls[0]?.[1]).toEqual({ id: 7, format: "markdown" });
    await dispatchAction(actions, { action: "create", collection_id: 3, title: "T", content: "C" });
    expect(run.mock.calls[1]?.[1]).toEqual({ collection_id: 3, title: "T", content: "C", format: "markdown", ai_enabled: true });
    const published = await dispatchAction(actions, { action: "create", collection_id: 3, title: "T", content: "C", status: "published" });
    expect(published.isError).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
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
