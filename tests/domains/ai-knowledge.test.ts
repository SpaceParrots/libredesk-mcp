import { describe, expect, it } from "vitest";
import type { Profile } from "../../src/config.js";
import { NotFoundError } from "../../src/errors.js";
import { aiKnowledgeDomain } from "../../src/domains/ai-knowledge.js";
import { DOMAINS } from "../../src/domains/index.js";
import { runOperation } from "../../src/ops/run.js";

const profile: Profile = { name: "t", url: "https://ex.com", apiKey: "key", apiSecret: "secret" };

interface Call {
  readonly method: string;
  readonly path: string;
  readonly search: string;
  readonly body: unknown;
}

function fakeFetch(respond: (call: Call) => unknown = () => true) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init?.method ?? "GET",
      path: url.pathname,
      search: url.search,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    };
    calls.push(call);
    return Promise.resolve(
      new Response(JSON.stringify({ status: "success", data: respond(call) }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
  };
  return { fetchImpl, calls };
}

function op(name: string) {
  const found = aiKnowledgeDomain.operations.find((o) => o.name === name);
  if (!found) throw new Error(`no operation ${name}`);
  return found;
}

const long = "x".repeat(300);
const snippets = [
  { id: 3, title: "Refunds", content: "Full policy", enabled: true, source: "manual", source_url: "", updated_at: "t" },
  { id: 4, title: "Shipping", content: `Parcels take days ${long}`, enabled: false, source: "manual", source_url: "", updated_at: "t" },
];
const suggestion = { id: 9, question: "Suggested question?", answer: "Suggested answer.", status: "pending" };

const respondWithData = (call: Call) => {
  if (call.path === "/api/v1/ai/snippets" && call.method === "GET") return snippets;
  if (call.path === "/api/v1/ai/faq-suggestions") return [suggestion];
  return true;
};

const cases: [string, string, string, Record<string, unknown>, unknown][] = [
  ["snippet_list", "GET", "/api/v1/ai/snippets", {}, undefined],
  ["snippet_get", "GET", "/api/v1/ai/snippets", { id: 3 }, undefined],
  ["snippet_import_url", "POST", "/api/v1/ai/snippets/import-url", { url: "https://ex.com/a" }, { url: "https://ex.com/a" }],
  ["snippet_delete", "DELETE", "/api/v1/ai/snippets/3", { id: 3 }, undefined],
  ["faq_reject", "POST", "/api/v1/ai/faq-suggestions/9/reject", { id: 9 }, undefined],
  ["learning_get", "GET", "/api/v1/ai/faq-learning", {}, undefined],
];

describe("ai knowledge domain", () => {
  it("is registered with its tool name and toolset", () => {
    expect(DOMAINS).toContain(aiKnowledgeDomain);
    expect(aiKnowledgeDomain.name).toBe("knowledge");
    expect(aiKnowledgeDomain.tool).toBe("libredesk_ai_knowledge");
    expect(aiKnowledgeDomain.toolset).toBe("knowledge");
  });

  it("marks every operation undocumented and gated by ai:manage", () => {
    for (const o of aiKnowledgeDomain.operations) {
      expect(o.undocumented, o.name).toBe(true);
      expect(o.permission, o.name).toBe("ai:manage");
    }
  });

  it.each(cases)("%s sends %s %s", async (name, method, path, input, body) => {
    const { fetchImpl, calls } = fakeFetch(respondWithData);
    await runOperation(op(name), input, { profile, fetchImpl });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe(method);
    expect(calls[0]?.path).toBe(path);
    expect(calls[0]?.body).toEqual(body);
  });

  it("snippet_update keeps fields the caller did not pass", async () => {
    const { fetchImpl, calls } = fakeFetch(respondWithData);
    await runOperation(op("snippet_update"), { id: 3, title: "Refund policy" }, { profile, fetchImpl });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.method).toBe("PUT");
    expect(calls[1]?.path).toBe("/api/v1/ai/snippets/3");
    expect(calls[1]?.body).toEqual({ title: "Refund policy", content: "Full policy", enabled: true });
  });

  it("snippet_update and snippet_get report a missing snippet", async () => {
    const { fetchImpl } = fakeFetch(respondWithData);
    await expect(runOperation(op("snippet_update"), { id: 99, title: "x" }, { profile, fetchImpl })).rejects.toBeInstanceOf(NotFoundError);
    await expect(runOperation(op("snippet_get"), { id: 99 }, { profile, fetchImpl })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("snippet_get returns the full snippet", async () => {
    const { fetchImpl } = fakeFetch(respondWithData);
    expect(await runOperation(op("snippet_get"), { id: 4 }, { profile, fetchImpl })).toEqual(snippets[1]);
  });

  it("snippet_list filters by search and enabled and trims content to a preview", async () => {
    const { fetchImpl } = fakeFetch(respondWithData);
    const ids = async (input: Record<string, unknown>) =>
      ((await runOperation(op("snippet_list"), input, { profile, fetchImpl })) as Record<string, unknown>[]).map((s) => s.id);

    const all = (await runOperation(op("snippet_list"), {}, { profile, fetchImpl })) as Record<string, unknown>[];
    expect(all.map((s) => s.id)).toEqual([3, 4]);
    expect(all[1]?.preview).toBe(`Parcels take days ${long}`.slice(0, 160));
    expect(all[1]).not.toHaveProperty("content");

    expect(await ids({ search: "FULL POLICY" })).toEqual([3]);
    expect(await ids({ search: "shipping" })).toEqual([4]);
    expect(await ids({ enabled: false })).toEqual([4]);
  });

  it("snippet_create defaults enabled to true", async () => {
    const { fetchImpl, calls } = fakeFetch();
    await runOperation(op("snippet_create"), { title: "T", content: "C" }, { profile, fetchImpl });
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toEqual({ title: "T", content: "C", enabled: true });
  });

  it("faq_list sends the status as a query parameter", async () => {
    const { fetchImpl, calls } = fakeFetch(() => []);
    await runOperation(op("faq_list"), { status: "pending" }, { profile, fetchImpl });
    expect(calls[0]?.path).toBe("/api/v1/ai/faq-suggestions");
    expect(calls[0]?.search).toBe("?status=pending");
  });

  it("faq_approve fills question and answer from the suggestion", async () => {
    const { fetchImpl, calls } = fakeFetch(respondWithData);
    await runOperation(op("faq_approve"), { id: 9, answer: "Better answer." }, { profile, fetchImpl });
    expect(calls[1]?.method).toBe("POST");
    expect(calls[1]?.path).toBe("/api/v1/ai/faq-suggestions/9/approve");
    expect(calls[1]?.body).toEqual({ question: "Suggested question?", answer: "Better answer." });
  });

  it("faq_approve skips the lookup when both texts are given", async () => {
    const { fetchImpl, calls } = fakeFetch(respondWithData);
    await runOperation(op("faq_approve"), { id: 9, question: "Q", answer: "A" }, { profile, fetchImpl });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ question: "Q", answer: "A" });
  });

  it("faq_approve reports a missing suggestion", async () => {
    const { fetchImpl } = fakeFetch(respondWithData);
    await expect(runOperation(op("faq_approve"), { id: 99 }, { profile, fetchImpl })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("learning_set sends { enabled }", async () => {
    const { fetchImpl, calls } = fakeFetch();
    await runOperation(op("learning_set"), { enabled: false }, { profile, fetchImpl });
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.path).toBe("/api/v1/ai/faq-learning");
    expect(calls[0]?.body).toEqual({ enabled: false });
  });
});
