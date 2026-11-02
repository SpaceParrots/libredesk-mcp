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

  it.each(["action", "profile", "json", "yes"])("rejects a reserved input field name %s", (field) => {
    expect(() =>
      defineOperation({ ...base, name: "get", path: "/x", input: { [field]: z.string().optional() }, query: [field] }),
    ).toThrow(`get: input field ${field} is reserved`);
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

  it("rejects a path param that is optional without a default", () => {
    expect(() =>
      defineOperation({ ...base, name: "get", path: "/x/{id}", input: { id: z.number().optional() } }),
    ).toThrow("get: path param {id} must not be optional");
    const op = defineOperation({ ...base, name: "get", path: "/x/{id}", input: { id: z.number().default(0) } });
    expect(op.path).toBe("/x/{id}");
  });

  it("rejects GET and DELETE fields that are neither path params nor query fields", () => {
    for (const method of ["GET", "DELETE"] as const) {
      expect(() =>
        defineOperation({
          ...base,
          name: "get",
          method,
          path: "/x/{id}",
          input: { id: z.number(), page: z.number().optional(), extra: z.string().optional() },
          query: ["page"],
        }),
      ).toThrow(`get: ${method} field extra is neither a path param nor a query field`);
    }
  });

  it("allows extra GET fields when the operation has its own run", () => {
    const op = defineOperation({
      ...base,
      name: "search",
      path: "/x",
      input: { term: z.string() },
      run: async (input) => input.term,
    });
    expect(op.name).toBe("search");
  });

  it("requires grouped names to carry the group prefix", () => {
    expect(() => defineOperation({ ...base, name: "create", group: "collection", path: "/x", input: {} })).toThrow(
      /create: .*collection_/,
    );
  });

  it("accepts cli help with hidden optional fields", () => {
    const op = {
      ...base,
      name: "get",
      path: "/x/{id}",
      input: { id: z.number(), collection_id: z.number().default(0) },
      query: ["collection_id"] as const,
      cli: { examples: ["ldesk x get 1"], notes: ["Note."], hidden: ["collection_id"] as const },
    };
    expect(defineOperation(op)).toBe(op);
  });

  it("rejects hidden cli fields that are unknown or required", () => {
    const input = { id: z.number(), locale: z.string().optional() };
    expect(() =>
      defineOperation({ ...base, name: "get", path: "/x/{id}", input, query: ["locale"], cli: { hidden: ["slug" as "id"] } }),
    ).toThrow(/get: hidden field slug is not an input field/);
    expect(() =>
      defineOperation({ ...base, name: "get", path: "/x/{id}", input, query: ["locale"], cli: { hidden: ["id"] } }),
    ).toThrow(/get: hidden field id is required/);
  });

  it("rejects cli examples that are not ldesk commands", () => {
    expect(() => defineOperation({ ...base, name: "list", path: "/x", input: {}, cli: { examples: ["list --json"] } })).toThrow(
      /list: example "list --json" must start with "ldesk "/,
    );
  });

  it("requires an escalation to raise the impact and to say when and what", () => {
    const write = { ...base, method: "POST", impact: "write", name: "create", path: "/x", input: { status: z.string().optional() } } as const;
    const escalate = { when: (values: Readonly<Record<string, unknown>>) => values.status === "published", condition: "status is published" };
    expect(() => defineOperation({ ...write, escalate: { ...escalate, impact: "caution", effect: "" } })).toThrow(
      /create: escalate needs an effect/,
    );
    expect(() => defineOperation({ ...write, escalate: { ...escalate, condition: "", impact: "caution", effect: "Goes public." } })).toThrow(
      /create: escalate needs a condition/,
    );
    expect(() =>
      defineOperation({ ...write, impact: "destructive", effect: "Gone.", escalate: { ...escalate, impact: "caution", effect: "Goes public." } }),
    ).toThrow(/create: escalate must raise the impact/);
    const op = { ...write, escalate: { ...escalate, impact: "caution", effect: "Goes public." } } as const;
    expect(defineOperation(op)).toBe(op);
  });
});

describe("defineDomain", () => {
  const op = (name: string) => defineOperation({ ...base, name, path: "/x", input: {} });

  it("returns the domain unchanged when valid", () => {
    const domain = {
      name: "help-center",
      tool: "libredesk_help_center",
      actionPrefix: "help_center",
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
        actionPrefix: "help_center",
        toolset: "knowledge",
        summary: "s",
        operations: [op("list"), op("list")],
      }),
    ).toThrow(/help-center: duplicate operation list/);
  });

  it("requires a description for every operation group", () => {
    const grouped = defineOperation({ ...base, name: "collection_list", group: "collection", path: "/x", input: {} });
    const domain = { name: "help-center", tool: "libredesk_help_center", actionPrefix: "help_center", toolset: "knowledge", summary: "s", operations: [grouped] } as const;
    expect(() => defineDomain(domain)).toThrow(/help-center: group collection needs a description in groups/);
    const described = { ...domain, groups: { collection: "Manage collections." } };
    expect(defineDomain(described)).toBe(described);
  });
});
