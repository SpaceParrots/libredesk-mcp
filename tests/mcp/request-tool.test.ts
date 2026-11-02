import { afterEach, describe, expect, it, vi } from "vitest";
import { DOMAINS } from "../../src/domains/index.js";
import { dispatchAction } from "../../src/mcp/action-tool.js";
import { registerRequestTool, requestActions } from "../../src/mcp/request-tool.js";
import { recordingServer, type RecordedTool } from "./helpers.js";

function text(result: { content: { text: string }[] }): string {
  return result.content[0]?.text ?? "";
}

describe("libredesk_request", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("registers call and catalog as a destructive tool", () => {
    const recorded: RecordedTool[] = [];
    registerRequestTool(recordingServer(recorded), DOMAINS);
    expect(recorded[0]?.name).toBe("libredesk_request");
    expect(recorded[0]?.annotations).toEqual({ readOnlyHint: false, destructiveHint: true });
    expect(recorded[0]?.description).toContain("- call(method, path, ...)");
  });

  it("catalog filtered by domain lists actions with fields", async () => {
    const res = await dispatchAction(requestActions(DOMAINS), { action: "catalog", domain: "help-center" });
    const entries = JSON.parse(text(res)) as { tool: string; action: string; fields: { name: string }[] }[];
    expect(entries.every((e) => e.tool === "libredesk_help_center")).toBe(true);
    expect(entries.find((e) => e.action === "get")?.fields.map((f) => f.name)).toEqual(["id"]);
  });

  it("catalog without domain lists every operation without fields", async () => {
    const res = await dispatchAction(requestActions(DOMAINS), { action: "catalog" });
    const entries = JSON.parse(text(res)) as Record<string, unknown>[];
    expect(new Set(entries.map((e) => e.tool))).toEqual(new Set(DOMAINS.map((d) => d.tool)));
    expect(entries[0]).not.toHaveProperty("fields");
  });

  it("catalog with an unknown domain lists the known ones", async () => {
    const res = await dispatchAction(requestActions(DOMAINS), { action: "catalog", domain: "nope" });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("Known domains: help-center, articles");
  });

  it("call with a query string in the path points to the query field, not CLI flags", async () => {
    const res = await dispatchAction(requestActions(DOMAINS), { action: "call", method: "GET", path: "/api/v1/tags?a=1" });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("query field");
    expect(text(res)).not.toContain("--query");
  });

  it("call with a disallowed path does not mention shell workarounds", async () => {
    const res = await dispatchAction(requestActions(DOMAINS), { action: "call", method: "GET", path: "/admin" });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("/api/v1/");
    expect(text(res)).not.toContain("MSYS_NO_PATHCONV");
  });

  it("call DELETE without confirm returns an error result", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const res = await dispatchAction(requestActions(DOMAINS), { action: "call", method: "DELETE", path: "/api/v1/help-centers/1" });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("DELETE /api/v1/help-centers/1 deletes data.");
    expect(text(res)).toContain("confirm: true");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("call sends the request with the env profile and returns the unwrapped data", async () => {
    vi.stubEnv("LIBREDESK_URL", "https://desk.example");
    vi.stubEnv("LIBREDESK_API_KEY", "key-12345678");
    vi.stubEnv("LIBREDESK_API_SECRET", "secret-12345678");
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "success", data: [{ id: 1 }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);
    const res = await dispatchAction(requestActions(DOMAINS), { action: "call", method: "GET", path: "/api/v1/help-centers", query: { page: 1 } });
    expect(res.isError).toBeUndefined();
    expect(text(res)).toBe('[{"id":1}]');
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("https://desk.example/api/v1/help-centers?page=1");
  });

  it("call rejects a path outside /api/v1/", async () => {
    const res = await dispatchAction(requestActions(DOMAINS), { action: "call", method: "GET", path: "/admin" });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('Path "/admin" is not allowed.');
  });
});
