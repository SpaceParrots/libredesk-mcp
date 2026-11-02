import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildCatalog } from "../../src/ops/catalog.js";
import { defineDomain, defineOperation } from "../../src/ops/define.js";

const list = defineOperation({
  name: "list",
  summary: "List help centers",
  method: "GET",
  path: "/api/v1/help-centers",
  input: {},
  impact: "read",
});
const remove = defineOperation({
  name: "delete",
  summary: "Delete a help center",
  method: "DELETE",
  path: "/api/v1/help-centers/{id}",
  input: { id: z.number() },
  impact: "destructive",
  effect: "Deletes it.",
  undocumented: true,
  mcp: false,
});
const helpCenters = defineDomain({
  name: "help-center",
  tool: "libredesk_help_center",
  toolset: "knowledge",
  summary: "s",
  operations: [list, remove],
});
const macros = defineDomain({
  name: "macro",
  tool: "libredesk_macro",
  toolset: "workflow",
  summary: "s",
  operations: [
    defineOperation({ name: "list", summary: "List macros", method: "GET", path: "/api/v1/macros", input: {}, impact: "read" }),
  ],
});

describe("buildCatalog", () => {
  it("lists every operation of every domain, mcp:false included", () => {
    const catalog = buildCatalog([helpCenters, macros]);
    expect(catalog.map((e) => `${e.tool}.${e.action}`)).toEqual([
      "libredesk_help_center.list",
      "libredesk_help_center.delete",
      "libredesk_macro.list",
    ]);
    expect(catalog[1]).toEqual({
      domain: "help-center",
      tool: "libredesk_help_center",
      action: "delete",
      method: "DELETE",
      path: "/api/v1/help-centers/{id}",
      summary: "Delete a help center",
      impact: "destructive",
      undocumented: true,
      fields: [{ name: "id", kind: "number", required: true, description: "", nullable: false, array: false }],
    });
    expect(catalog[0]?.undocumented).toBe(false);
  });

  it("filters by domain name or tool name", () => {
    expect(buildCatalog([helpCenters, macros], "macro").map((e) => e.summary)).toEqual(["List macros"]);
    expect(buildCatalog([helpCenters, macros], "libredesk_help_center")).toHaveLength(2);
    expect(buildCatalog([helpCenters, macros], "nope")).toEqual([]);
  });
});
