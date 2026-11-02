import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineOperation } from "../../src/ops/define.js";
import { fieldInfo, operationFields } from "../../src/ops/fields.js";

describe("fieldInfo", () => {
  it("marks nullable fields", () => {
    expect(fieldInfo("p", z.number().nullable().optional()).nullable).toBe(true);
    expect(fieldInfo("p", z.number().optional()).nullable).toBe(false);
  });

  it("describes optional enums with defaults", () => {
    expect(fieldInfo("status", z.enum(["draft", "published"]).default("draft").describe("d"))).toMatchObject({
      name: "status",
      kind: "enum",
      required: false,
      enumValues: ["draft", "published"],
      defaultValue: "draft",
      description: "d",
      array: false,
    });
  });

  it("describes required scalars", () => {
    expect(fieldInfo("id", z.number().describe("ID"))).toEqual({
      name: "id",
      kind: "number",
      required: true,
      description: "ID",
      nullable: false,
      array: false,
    });
    expect(fieldInfo("on", z.boolean())).toMatchObject({ kind: "boolean", required: true, description: "" });
    expect(fieldInfo("title", z.string().optional())).toMatchObject({ kind: "string", required: false });
  });

  it("finds a description set inside a wrapper", () => {
    expect(fieldInfo("title", z.string().describe("inner").optional()).description).toBe("inner");
  });

  it("treats nullable fields as required unless they have a default", () => {
    expect(fieldInfo("x", z.string().nullable())).toMatchObject({ kind: "string", required: true });
    expect(fieldInfo("x", z.string().nullable().default(null))).toMatchObject({ required: false, defaultValue: null });
  });

  it("treats records and objects as json", () => {
    expect(fieldInfo("meta", z.record(z.string(), z.unknown())).kind).toBe("json");
    expect(fieldInfo("obj", z.object({ a: z.string() }).optional())).toMatchObject({
      kind: "json",
      required: false,
      array: false,
    });
    expect(fieldInfo("ids", z.array(z.number()))).toMatchObject({ kind: "json", array: false });
  });

  it("treats string arrays as repeatable strings", () => {
    expect(fieldInfo("tags", z.array(z.string()).optional())).toMatchObject({
      kind: "string",
      array: true,
      required: false,
    });
    expect(fieldInfo("states", z.array(z.enum(["a", "b"])))).toMatchObject({
      kind: "enum",
      array: true,
      enumValues: ["a", "b"],
    });
  });
});

describe("operationFields", () => {
  it("lists every input field in declaration order", () => {
    const op = defineOperation({
      name: "get",
      summary: "s",
      method: "GET",
      path: "/x/{id}",
      input: { id: z.number(), locale: z.string().optional() },
      query: ["locale"],
      impact: "read",
    });
    expect(operationFields(op).map((f) => [f.name, f.kind, f.required])).toEqual([
      ["id", "number", true],
      ["locale", "string", false],
    ]);
  });
});
