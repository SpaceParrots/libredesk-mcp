import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildDescription, dispatchAction, jsonContent, mcpProfileError, mergeShapes, toolErrorResult, type ActionMap } from "../../src/mcp/action-tool.js";
import { PermissionError } from "../../src/errors.js";

function text(result: { content: { text: string }[] }): string {
  return result.content[0]?.text ?? "";
}

/** Two actions: `greet` (required `name`) and `count` (optional `n`, defaulted `mode`). */
function makeActions(calls: unknown[]): ActionMap {
  return {
    greet: {
      summary: "Greet someone.",
      shape: { name: z.string().describe("Who to greet") },
      handler: async (a) => {
        calls.push(a);
        return { content: [{ type: "text", text: `hi ${String(a.name)}` }] };
      },
    },
    count: {
      summary: "Count optionally.",
      shape: { n: z.number().optional().describe("A number"), mode: z.enum(["a", "b"]).default("a").describe("Mode") },
      handler: async (a) => {
        calls.push(a);
        return { content: [{ type: "text", text: `n=${String(a.n ?? 0)}` }] };
      },
    },
  };
}

describe("dispatchAction", () => {
  it("validates and dispatches the matching action with defaults applied", async () => {
    const calls: unknown[] = [];
    const res = await dispatchAction(makeActions(calls), { action: "count", n: 3 });
    expect(res.isError).toBeUndefined();
    expect(text(res)).toBe("n=3");
    expect(calls).toEqual([{ n: 3, mode: "a" }]);
  });

  it("strips action and profile before validating", async () => {
    const calls: unknown[] = [];
    const res = await dispatchAction(makeActions(calls), { action: "greet", name: "Ada", profile: "prod" });
    expect(res.isError).toBeUndefined();
    expect(calls).toEqual([{ name: "Ada" }]);
  });

  it("rejects a field of another action, naming it", async () => {
    const calls: unknown[] = [];
    const res = await dispatchAction(makeActions(calls), { action: "count", name: "Ada" });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("name: not a field of this action");
    expect(text(res)).toContain("Hint: Fields of count: n, mode.");
    expect(calls).toEqual([]);
  });

  it("returns an error result for an unknown or inherited action", async () => {
    const calls: unknown[] = [];
    for (const action of ["nope", "toString", undefined]) {
      const res = await dispatchAction(makeActions(calls), { action });
      expect(res.isError).toBe(true);
      expect(text(res)).toMatch(/Unknown action/);
      expect(text(res)).toContain("greet, count");
    }
    expect(calls).toEqual([]);
  });

  it("returns an error result naming a missing required field", async () => {
    const res = await dispatchAction(makeActions([]), { action: "greet" });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/Invalid input for action "greet": name:/);
  });

  it("rejects a non-string profile", async () => {
    const res = await dispatchAction(makeActions([]), { action: "greet", name: "x", profile: 3 });
    expect(res.isError).toBe(true);
  });

  it("turns a thrown error into message and hint, without the cause", async () => {
    const actions: ActionMap = {
      boom: {
        summary: "throws",
        shape: {},
        handler: () =>
          Promise.reject(
            new PermissionError("Permission denied.", { status: 403, hint: "Grant help_center:manage.", cause: new Error("inner detail") }),
          ),
      },
    };
    const res = await dispatchAction(actions, { action: "boom" });
    expect(res).toEqual({ content: [{ type: "text", text: "Permission denied.\nHint: Grant help_center:manage." }], isError: true });
  });
});

describe("toolErrorResult and jsonContent", () => {
  it("normalises a plain error and a string", () => {
    expect(text(toolErrorResult(new Error("plain")))).toBe("plain");
    expect(text(toolErrorResult("oops"))).toBe("oops");
  });

  it("returns compact masked JSON", () => {
    expect(text(jsonContent({ a: 1, api_secret: "supersecret99" }))).toBe('{"a":1,"api_secret":"••••et99"}');
    expect(text(jsonContent(undefined))).toBe("null");
  });
});

describe("mergeShapes", () => {
  it("makes every field optional and drops defaults", () => {
    const merged = z.object(mergeShapes(makeActions([])));
    expect(merged.parse({})).toEqual({});
  });

  it("names actions whose description of a shared field differs", () => {
    const actions: ActionMap = {
      get: { summary: "", shape: { id: z.number().describe("Help center id.") }, handler: () => Promise.reject(new Error()) },
      delete: { summary: "", shape: { id: z.number().describe("Help center id.") }, handler: () => Promise.reject(new Error()) },
      collection_get: { summary: "", shape: { id: z.number().describe("Collection id.") }, handler: () => Promise.reject(new Error()) },
    };
    expect(z.globalRegistry.get(mergeShapes(actions).id as z.core.$ZodType)?.description).toBe("Help center id. For collection_get: Collection id.");
  });
});

describe("buildDescription", () => {
  it("lists each action with its fields, optional ones marked", () => {
    expect(buildDescription("Things.", makeActions([]))).toBe(
      "Things.\n\nActions:\n- greet(name): Greet someone.\n- count(...): Count optionally.",
    );
  });
});

describe("mcpProfileError", () => {
  it("allows any profile when LIBREDESK_MCP_PROFILES is unset or empty", () => {
    expect(mcpProfileError("x", {})).toBeUndefined();
    expect(mcpProfileError("x", { LIBREDESK_MCP_PROFILES: " " })).toBeUndefined();
  });

  it("allows no profile argument, and only listed names otherwise", () => {
    const env = { LIBREDESK_MCP_PROFILES: "a, b" };
    expect(mcpProfileError(undefined, env)).toBeUndefined();
    expect(mcpProfileError("b", env)).toBeUndefined();
    expect(mcpProfileError("c", env)).toBe('profile "c" is not allowed for this server. Allowed: a, b (LIBREDESK_MCP_PROFILES).');
  });
});
