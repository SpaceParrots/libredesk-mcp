import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Profile } from "../../src/config.js";
import { InputError, PermissionError } from "../../src/errors.js";
import { defineOperation } from "../../src/ops/define.js";
import { runOperation, splitInput, validateInput } from "../../src/ops/run.js";

const profile: Profile = { name: "t", url: "https://ex.com", apiKey: "key", apiSecret: "secret" };

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

function fakeFetch(status: number, payload: unknown) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    return Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }));
  };
  return { fetchImpl, calls };
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected rejection");
}

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected throw");
}

const op = defineOperation({
  name: "collection_update",
  group: "collection",
  summary: "s",
  method: "PUT",
  path: "/api/v1/help-centers/{help_center_id}/collections/{id}",
  input: { help_center_id: z.number(), id: z.number(), name: z.string().optional(), locale: z.string().optional() },
  query: ["locale"],
  impact: "write",
});

const getOp = defineOperation({
  name: "get",
  summary: "s",
  method: "GET",
  path: "/api/v1/things/{id}",
  input: { id: z.string(), page: z.number().default(1), extra: z.string().optional() },
  query: ["page"],
  impact: "read",
});

describe("splitInput", () => {
  it("splits path, query and body", () => {
    expect(splitInput(op, { help_center_id: 1, id: 2, name: "FAQ", locale: "de" })).toEqual({
      path: "/api/v1/help-centers/1/collections/2",
      query: { locale: "de" },
      body: { name: "FAQ" },
    });
  });

  it("url-encodes path params", () => {
    expect(splitInput(getOp, { id: "a/b", page: 1 }).path).toBe("/api/v1/things/a%2Fb");
  });

  it("omits undefined values and leaves an empty body undefined", () => {
    expect(splitInput(op, { help_center_id: 1, id: 2, name: undefined, locale: undefined })).toEqual({
      path: "/api/v1/help-centers/1/collections/2",
      query: {},
      body: undefined,
    });
  });

  it("never sends a body for GET or DELETE", () => {
    expect(splitInput(getOp, { id: "x", page: 2, extra: "y" }).body).toBeUndefined();
  });
});

describe("validateInput", () => {
  it("rejects unknown fields and names them", () => {
    const error = thrown(() => validateInput(op, { help_center_id: 1, id: 2, nmae: "x" }));
    expect(error).toBeInstanceOf(InputError);
    expect((error as InputError).fields).toEqual(["nmae"]);
    expect((error as InputError).message).toMatch(/nmae: /);
  });

  it("names each invalid or missing field in fields and message", () => {
    const error = thrown(() => validateInput(op, { id: "2" })) as InputError;
    expect(error).toBeInstanceOf(InputError);
    expect([...error.fields].sort()).toEqual(["help_center_id", "id"]);
    expect(error.message).toMatch(/help_center_id: /);
    expect(error.message).toMatch(/\bid: /);
  });

  it("treats undefined and null as empty input and applies defaults", () => {
    const noInput = defineOperation({
      name: "list",
      summary: "s",
      method: "GET",
      path: "/x",
      input: { page: z.number().default(1) },
      query: ["page"],
      impact: "read",
    });
    expect(validateInput(noInput, undefined)).toEqual({ page: 1 });
    expect(validateInput(noInput, null)).toEqual({ page: 1 });
  });
});

describe("runOperation", () => {
  it("sends the default request and unwraps the envelope", async () => {
    const { fetchImpl, calls } = fakeFetch(200, { status: "success", data: { id: 2 } });
    const result = await runOperation(op, { help_center_id: 1, id: 2, name: "FAQ", locale: "de" }, { profile, fetchImpl });
    expect(result).toEqual({ id: 2 });
    expect(calls).toEqual([
      { url: "https://ex.com/api/v1/help-centers/1/collections/2?locale=de", method: "PUT", body: { name: "FAQ" } },
    ]);
  });

  it("sends zod defaults", async () => {
    const { fetchImpl, calls } = fakeFetch(200, { status: "success", data: [] });
    await runOperation(getOp, { id: "x" }, { profile, fetchImpl });
    expect(calls[0]?.url).toBe("https://ex.com/api/v1/things/x?page=1");
  });

  it("rejects invalid input before any request", async () => {
    const { fetchImpl, calls } = fakeFetch(200, {});
    expect(await caught(runOperation(op, { id: 2 }, { profile, fetchImpl }))).toBeInstanceOf(InputError);
    expect(calls).toHaveLength(0);
  });

  it("uses op.run when present and passes a ctx bound to the profile", async () => {
    const { fetchImpl, calls } = fakeFetch(200, { status: "success", data: { ok: true } });
    const custom = defineOperation({
      name: "custom",
      summary: "s",
      method: "POST",
      path: "/x",
      input: { id: z.number() },
      impact: "write",
      run: async (input, ctx) => {
        const data = await ctx.call<{ ok: boolean }>("POST", `/api/v1/custom/${input.id}`, { body: { a: 1 } });
        return { profile: ctx.profile.name, data };
      },
    });
    expect(await runOperation(custom, { id: 7 }, { profile, fetchImpl })).toEqual({ profile: "t", data: { ok: true } });
    expect(calls).toEqual([{ url: "https://ex.com/api/v1/custom/7", method: "POST", body: { a: 1 } }]);
  });

  it("applies present to the result", async () => {
    const { fetchImpl } = fakeFetch(200, { status: "success", data: { id: 2, name: "FAQ" } });
    const presented = defineOperation({
      name: "get",
      summary: "s",
      method: "GET",
      path: "/x/{id}",
      input: { id: z.number() },
      impact: "read",
      present: (data, input) => ({ shown: (data as { name: string }).name, id: input.id }),
    });
    expect(await runOperation(presented, { id: 2 }, { profile, fetchImpl })).toEqual({ shown: "FAQ", id: 2 });
  });

  it("adds the permission name to a PermissionError hint", async () => {
    const { fetchImpl } = fakeFetch(403, { status: "error", message: "Permission denied", error_type: "PermissionException" });
    const guarded = defineOperation({ ...op, permission: "help_center:manage" });
    const error = await caught(runOperation(guarded, { help_center_id: 1, id: 2 }, { profile, fetchImpl }));
    expect(error).toBeInstanceOf(PermissionError);
    const pe = error as PermissionError;
    expect(pe.message).toBe("Permission denied");
    expect(pe.status).toBe(403);
    expect(pe.errorType).toBe("PermissionException");
    expect(pe.permission).toBe("help_center:manage");
    expect(pe.hint).toMatch(/`help_center:manage`/);
  });

  it("leaves a PermissionError alone when the operation names no permission", async () => {
    const { fetchImpl } = fakeFetch(403, { status: "error", message: "Permission denied" });
    const error = (await caught(runOperation(op, { help_center_id: 1, id: 2 }, { profile, fetchImpl }))) as PermissionError;
    expect(error).toBeInstanceOf(PermissionError);
    expect(error.permission).toBeUndefined();
    expect(error.hint).not.toMatch(/help_center/);
  });
});
