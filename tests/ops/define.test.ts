import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineDomain, defineOperation } from "../../src/ops/define.js";

const base = { summary: "s", method: "GET", impact: "read" } as const;

describe("defineOperation", () => {
  it("returns the operation unchanged when valid", () => {
    const op = {
      ...base,
      name: "collection_get",
      group: "collection",
      path: "/x/{id}",
      input: { id: z.number(), locale: z.string().optional() },
      query: ["locale"] as const,
      positional: ["id"] as const,
    };
    expect(defineOperation(op)).toBe(op);
  });

  it("rejects a path param missing from input", () => {
    expect(() => defineOperation({ ...base, name: "get", path: "/x/{id}", input: {} })).toThrow(
      "get: path param {id} is not an input field",
    );
  });

  it("rejects query and positional entries missing from input", () => {
    const input = { id: z.number() };
    expect(() => defineOperation({ ...base, name: "list", path: "/x", input, query: ["page" as "id"] })).toThrow(
      /list: query field page/,
    );
    expect(() => defineOperation({ ...base, name: "list", path: "/x", input, positional: ["slug" as "id"] })).toThrow(
      /list: positional field slug/,
    );
  });

  it("requires an effect for caution and destructive operations", () => {
    for (const impact of ["caution", "destructive"] as const) {
      expect(() => defineOperation({ ...base, name: "delete", method: "DELETE", path: "/x", input: {}, impact })).toThrow(
        /delete: .*effect/,
      );
    }
    const op = defineOperation({
      ...base,
      name: "delete",
      method: "DELETE",
      path: "/x",
      input: {},
      impact: "destructive",
      effect: "Deletes the collection and its articles.",
    });
    expect(op.effect).toMatch(/Deletes/);
  });

  it("requires grouped names to carry the group prefix", () => {
    expect(() => defineOperation({ ...base, name: "create", group: "collection", path: "/x", input: {} })).toThrow(
      /create: .*collection_/,
    );
  });
});

describe("defineDomain", () => {
  const op = (name: string) => defineOperation({ ...base, name, path: "/x", input: {} });

  it("returns the domain unchanged when valid", () => {
    const domain = {
      name: "help-center",
      tool: "libredesk_help_center",
      toolset: "knowledge",
      summary: "s",
      operations: [op("list"), op("get")],
    } as const;
    expect(defineDomain(domain)).toBe(domain);
  });

  it("rejects duplicate operation names", () => {
    expect(() =>
      defineDomain({
        name: "help-center",
        tool: "libredesk_help_center",
        toolset: "knowledge",
        summary: "s",
        operations: [op("list"), op("list")],
      }),
    ).toThrow(/help-center: duplicate operation list/);
  });
});
