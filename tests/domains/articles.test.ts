import { describe, expect, it } from "vitest";
import type { Profile } from "../../src/config.js";
import { InputError } from "../../src/errors.js";
import { articlesDomain } from "../../src/domains/articles.js";
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
      new Response(JSON.stringify({ status: "success", data: respond(call) }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
  return { fetchImpl, calls };
}

function op(name: string) {
  const found = articlesDomain.operations.find((o) => o.name === name);
  if (!found) throw new Error(`no operation ${name}`);
  return found;
}

const article = {
  id: 4,
  collection_id: 2,
  author_id: 7,
  title: "Old",
  content: "<p>Body</p>",
  excerpt: "E",
  status: "published",
  ai_enabled: true,
  slug: "old",
  locale: "en",
  meta_title: "",
  meta_description: "",
  meta_image_url: "",
  sort_order: 3,
  view_count: 5,
  translations: [{ id: 9, locale: "de" }],
};

describe("articles domain", () => {
  it("is registered with its tool name and toolset", () => {
    expect(DOMAINS).toContain(articlesDomain);
    expect(articlesDomain.name).toBe("articles");
    expect(articlesDomain.tool).toBe("libredesk_articles");
    expect(articlesDomain.toolset).toBe("knowledge");
  });

  it("marks every operation undocumented and gated by help_center:manage", () => {
    for (const o of articlesDomain.operations) {
      expect(o.undocumented, o.name).toBe(true);
      expect(o.permission, o.name).toBe("help_center:manage");
    }
  });

  const cases: [string, string, string, Record<string, unknown>, unknown][] = [
    ["set_status", "PUT", "/api/v1/articles/4/status", { id: 4, status: "published" }, { status: "published" }],
    ["move", "PUT", "/api/v1/articles/4/collection", { id: 4, collection_id: 6 }, { collection_id: 6 }],
    ["linkable", "GET", "/api/v1/help-centers/1/linkable-articles", { help_center_id: 1, exclude_locale: "de" }, undefined],
    ["link_translation", "PUT", "/api/v1/articles/4/link-translation", { id: 4, translation_of_id: 9 }, { translation_of_id: 9 }],
    ["unlink_translation", "PUT", "/api/v1/articles/4/unlink-translation", { id: 4 }, undefined],
    ["delete", "DELETE", "/api/v1/collections/2/articles/4", { id: 4, collection_id: 2 }, undefined],
  ];

  it.each(cases)("%s sends %s %s", async (name, method, path, input, body) => {
    const { fetchImpl, calls } = fakeFetch(() => []);
    await runOperation(op(name), input, { profile, fetchImpl });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe(method);
    expect(calls[0]?.path).toBe(path);
    expect(calls[0]?.body).toEqual(body);
  });

  it("linkable sends exclude_locale as a query parameter", async () => {
    const { fetchImpl, calls } = fakeFetch(() => []);
    await runOperation(op("linkable"), { help_center_id: 1, exclude_locale: "de" }, { profile, fetchImpl });
    expect(calls[0]?.search).toBe("?exclude_locale=de");
  });

  it("delete without collection_id uses 0 in the path", async () => {
    const { fetchImpl, calls } = fakeFetch();
    await runOperation(op("delete"), { id: 4 }, { profile, fetchImpl });
    expect(calls[0]?.path).toBe("/api/v1/collections/0/articles/4");
  });

  it("set_status rejects a status other than draft and published", async () => {
    const { fetchImpl, calls } = fakeFetch();
    await expect(runOperation(op("set_status"), { id: 4, status: "archived" }, { profile, fetchImpl })).rejects.toBeInstanceOf(InputError);
    expect(calls).toHaveLength(0);
  });

  it("create converts markdown and defaults draft + ai_enabled", async () => {
    const { fetchImpl, calls } = fakeFetch();
    await runOperation(op("create"), { collection_id: 2, title: "Refunds", content: "## Policy" }, { profile, fetchImpl });
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.path).toBe("/api/v1/collections/2/articles");
    expect(calls[0]?.body).toEqual({ title: "Refunds", content: "<h2>Policy</h2>\n", status: "draft", ai_enabled: true });
  });

  it("create with format html sends content untouched", async () => {
    const { fetchImpl, calls } = fakeFetch();
    const html = "<table><tr><td>x</td></tr></table>";
    await runOperation(op("create"), { collection_id: 2, title: "T", content: html, format: "html", excerpt: "E" }, { profile, fetchImpl });
    expect(calls[0]?.body).toEqual({ title: "T", content: html, excerpt: "E", status: "draft", ai_enabled: true });
  });

  it("update keeps fields the caller did not pass", async () => {
    const { fetchImpl, calls } = fakeFetch(() => article);
    await runOperation(op("update"), { id: 4, title: "New" }, { profile, fetchImpl });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /api/v1/collections/0/articles/4",
      "PUT /api/v1/articles/4",
    ]);
    expect(calls[1]?.body).toEqual({
      slug: "old",
      locale: "en",
      title: "New",
      content: "<p>Body</p>",
      excerpt: "E",
      meta_title: "",
      meta_description: "",
      meta_image_url: "",
      sort_order: 3,
      status: "published",
      ai_enabled: true,
      author_id: 7,
    });
  });

  it("update converts content only when it was passed", async () => {
    const { fetchImpl, calls } = fakeFetch(() => article);
    await runOperation(op("update"), { id: 4, content: "**bold**", ai_enabled: false }, { profile, fetchImpl });
    expect(calls[1]?.body).toMatchObject({ content: "<p><strong>bold</strong></p>\n", ai_enabled: false, title: "Old" });
  });

  it("update rejects a status field", async () => {
    const { fetchImpl, calls } = fakeFetch(() => article);
    const error = await runOperation(op("update"), { id: 4, status: "published" }, { profile, fetchImpl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InputError);
    expect((error as InputError).fields).toEqual(["status"]);
    expect(calls).toHaveLength(0);
  });

  it("get returns markdown with content_format and keeps translations", async () => {
    const { fetchImpl, calls } = fakeFetch(() => article);
    const result = (await runOperation(op("get"), { id: 4 }, { profile, fetchImpl })) as Record<string, unknown>;
    expect(calls[0]?.path).toBe("/api/v1/collections/0/articles/4");
    expect(result).toMatchObject({ content: "Body", content_format: "markdown", translations: article.translations });
    expect(result.note).toBeUndefined();
  });

  it("get with format html returns the stored html", async () => {
    const { fetchImpl } = fakeFetch(() => article);
    const result = await runOperation(op("get"), { id: 4, format: "html" }, { profile, fetchImpl });
    expect(result).toMatchObject({ content: "<p>Body</p>", content_format: "html" });
  });

  it("get falls back to html for a table article", async () => {
    const html = "<table><tr><td>x</td></tr></table>";
    const { fetchImpl } = fakeFetch(() => ({ ...article, content: html }));
    const result = (await runOperation(op("get"), { id: 4 }, { profile, fetchImpl })) as Record<string, unknown>;
    expect(result.content).toBe(html);
    expect(result.content_format).toBe("html");
    expect(result.note).toContain("<table>");
  });

  it("list flattens the tree, filters by collection and drops content", async () => {
    const mk = (id: number, collection_id: number) => ({
      id,
      collection_id,
      title: `A${id}`,
      slug: `a${id}`,
      locale: "en",
      status: "draft",
      ai_enabled: true,
      updated_at: "2026-01-01T00:00:00Z",
      view_count: 1,
      helpful_count: 2,
      not_helpful_count: 3,
      content: "<p>secret body</p>",
      excerpt: "secret excerpt",
    });
    const child = { id: 3, name: "Child", articles: [mk(12, 3)], children: [] };
    const tree = [{ id: 2, name: "Top", articles: [mk(11, 2)], children: [child] }];
    const { fetchImpl, calls } = fakeFetch(() => ({ help_center: {}, tree }));

    const all = (await runOperation(op("list"), { help_center_id: 1, locale: "en" }, { profile, fetchImpl })) as Record<string, unknown>[];
    expect(calls[0]?.path).toBe("/api/v1/help-centers/1/tree");
    expect(calls[0]?.search).toBe("?locale=en");
    expect(all.map((a) => a.id)).toEqual([11, 12]);
    expect(all[1]).toEqual({
      collection_id: 3,
      collection_name: "Child",
      id: 12,
      title: "A12",
      slug: "a12",
      locale: "en",
      status: "draft",
      ai_enabled: true,
      updated_at: "2026-01-01T00:00:00Z",
      view_count: 1,
      helpful_count: 2,
      not_helpful_count: 3,
    });
    expect(JSON.stringify(all)).not.toContain("secret");

    const filtered = (await runOperation(op("list"), { help_center_id: 1, collection_id: 2 }, { profile, fetchImpl })) as Record<string, unknown>[];
    expect(filtered.map((a) => a.id)).toEqual([11]);
  });

  it("reorder sends the order record as body", async () => {
    const { fetchImpl, calls } = fakeFetch();
    await runOperation(op("reorder"), { collection_id: 2, order: { "11": 0, "12": 1 } }, { profile, fetchImpl });
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.path).toBe("/api/v1/collections/2/article-sort-order");
    expect(calls[0]?.body).toEqual({ "11": 0, "12": 1 });
  });
});
