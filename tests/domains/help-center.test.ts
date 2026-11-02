import { describe, expect, it } from "vitest";
import type { Profile } from "../../src/config.js";
import { InputError, NotFoundError } from "../../src/errors.js";
import { helpCenterDomain } from "../../src/domains/help-center.js";
import { DOMAINS } from "../../src/domains/index.js";
import { runOperation } from "../../src/ops/run.js";

const profile: Profile = { name: "t", url: "https://ex.com", apiKey: "key", apiSecret: "secret" };

interface Call {
  readonly method: string;
  readonly path: string;
  readonly search: string;
  readonly body: unknown;
}

type Responder = (call: Call) => unknown;

function fakeFetch(respond: Responder = () => true) {
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
    const data = respond(call);
    return Promise.resolve(
      new Response(JSON.stringify({ status: "success", data }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
  };
  return { fetchImpl, calls };
}

function op(name: string) {
  const found = helpCenterDomain.operations.find((o) => o.name === name);
  if (!found) throw new Error(`no operation ${name}`);
  return found;
}

const helpCenter = {
  id: 1,
  name: "Docs",
  slug: "docs",
  page_title: "Docs",
  meta_description: "All docs",
  custom_css: "a{color:red}",
  custom_js: "",
  theme: { color: "#000" },
  default_locale: "en",
  allowed_locales: ["en", "de"],
  custom_domain: "https://help.ex.com",
  template: "docs",
  livechat_inbox_id: null,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

const collection = {
  id: 3,
  help_center_id: 1,
  slug: "start",
  parent_id: null,
  locale: "en",
  name: "Start",
  description: "Getting started",
  icon: "rocket",
  sort_order: 2,
  is_published: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

const createBody = { name: "Docs", slug: "docs", page_title: "Docs" };

const cases: [string, string, string, Record<string, unknown>, unknown][] = [
  ["list", "GET", "/api/v1/help-centers", {}, undefined],
  ["get", "GET", "/api/v1/help-centers/1", { id: 1 }, undefined],
  ["locales", "GET", "/api/v1/help-centers/locales", {}, undefined],
  ["tree", "GET", "/api/v1/help-centers/1/tree", { id: 1, locale: "de" }, undefined],
  ["insights", "GET", "/api/v1/help-centers/1/insights", { id: 1 }, undefined],
  [
    "create",
    "POST",
    "/api/v1/help-centers",
    { ...createBody, template: "classic", livechat_inbox_id: null },
    { ...createBody, template: "classic", livechat_inbox_id: null },
  ],
  ["toggle", "PUT", "/api/v1/help-centers/1/toggle", { id: 1 }, undefined],
  ["delete", "DELETE", "/api/v1/help-centers/1", { id: 1 }, undefined],
  ["collection_list", "GET", "/api/v1/help-centers/1/collections", { help_center_id: 1 }, undefined],
  [
    "collection_create",
    "POST",
    "/api/v1/help-centers/1/collections",
    { help_center_id: 1, name: "Start", parent_id: null },
    { name: "Start", parent_id: null, is_published: false },
  ],
  ["collection_toggle", "PUT", "/api/v1/collections/3/toggle", { id: 3 }, undefined],
  [
    "collection_reorder",
    "PUT",
    "/api/v1/help-centers/1/collection-sort-order",
    { help_center_id: 1, order: { "3": 0, "5": 1 } },
    { "3": 0, "5": 1 },
  ],
  ["collection_delete", "DELETE", "/api/v1/help-centers/1/collections/3", { help_center_id: 1, id: 3 }, undefined],
];

describe("help center domain", () => {
  it("is registered with its tool name and toolset", () => {
    expect(DOMAINS).toContain(helpCenterDomain);
    expect(helpCenterDomain.name).toBe("help-center");
    expect(helpCenterDomain.tool).toBe("libredesk_help_center");
    expect(helpCenterDomain.toolset).toBe("knowledge");
  });

  it("marks every operation undocumented and gated by help_center:manage", () => {
    for (const o of helpCenterDomain.operations) {
      expect(o.undocumented, o.name).toBe(true);
      expect(o.permission, o.name).toBe("help_center:manage");
    }
  });

  it.each(cases)("%s sends %s %s", async (name, method, path, input, body) => {
    const { fetchImpl, calls } = fakeFetch(() => []);
    await runOperation(op(name), input, { profile, fetchImpl });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe(method);
    expect(calls[0]?.path).toBe(path);
    expect(calls[0]?.body).toEqual(body);
  });

  it("tree sends the locale as a query parameter", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ help_center: helpCenter, tree: [] }));
    await runOperation(op("tree"), { id: 1, locale: "de" }, { profile, fetchImpl });
    expect(calls[0]?.search).toBe("?locale=de");
  });

  it("create rejects a missing page_title and an unknown template", async () => {
    const { fetchImpl, calls } = fakeFetch();
    await expect(runOperation(op("create"), { name: "Docs", slug: "docs" }, { profile, fetchImpl })).rejects.toBeInstanceOf(InputError);
    await expect(runOperation(op("create"), { ...createBody, template: "fancy" }, { profile, fetchImpl })).rejects.toBeInstanceOf(InputError);
    expect(calls).toHaveLength(0);
  });

  it("collection_create defaults is_published to false", async () => {
    const { fetchImpl, calls } = fakeFetch();
    await runOperation(op("collection_create"), { help_center_id: 1, name: "Start" }, { profile, fetchImpl });
    expect(calls[0]?.body).toEqual({ name: "Start", is_published: false });
  });

  it("update keeps fields the caller did not pass", async () => {
    const { fetchImpl, calls } = fakeFetch(() => helpCenter);
    await runOperation(op("update"), { id: 1, page_title: "Help" }, { profile, fetchImpl });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /api/v1/help-centers/1", "PUT /api/v1/help-centers/1"]);
    expect(calls[1]?.body).toEqual({
      name: "Docs",
      slug: "docs",
      page_title: "Help",
      meta_description: "All docs",
      custom_css: "a{color:red}",
      custom_js: "",
      theme: { color: "#000" },
      default_locale: "en",
      allowed_locales: ["en", "de"],
      custom_domain: "https://help.ex.com",
      template: "docs",
      livechat_inbox_id: null,
    });
  });

  it("update lets the caller clear livechat_inbox_id and custom_domain", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ ...helpCenter, livechat_inbox_id: 4 }));
    await runOperation(op("update"), { id: 1, livechat_inbox_id: null, custom_domain: "" }, { profile, fetchImpl });
    expect(calls[1]?.body).toMatchObject({ livechat_inbox_id: null, custom_domain: "" });
  });

  it("collection_update merges from the collection list", async () => {
    const other = { ...collection, id: 9, name: "Other" };
    const { fetchImpl, calls } = fakeFetch(() => [other, collection]);
    await runOperation(op("collection_update"), { help_center_id: 1, id: 3, description: "New text" }, { profile, fetchImpl });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /api/v1/help-centers/1/collections",
      "PUT /api/v1/help-centers/1/collections/3",
    ]);
    expect(calls[1]?.body).toEqual({
      slug: "start",
      parent_id: null,
      locale: "en",
      name: "Start",
      description: "New text",
      icon: "rocket",
      sort_order: 2,
      is_published: true,
    });
  });

  it("collection_update on an unknown id throws NotFoundError and sends no PUT", async () => {
    const { fetchImpl, calls } = fakeFetch(() => [collection]);
    await expect(
      runOperation(op("collection_update"), { help_center_id: 1, id: 77, name: "x" }, { profile, fetchImpl }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(calls).toHaveLength(1);
  });

  it("collection_reorder sends the order record as the body", async () => {
    const { fetchImpl, calls } = fakeFetch();
    await runOperation(op("collection_reorder"), { help_center_id: 1, order: { "3": 0, "5": 1 } }, { profile, fetchImpl });
    expect(calls[0]?.body).toEqual({ "3": 0, "5": 1 });
  });

  it("list present drops theme and custom css/js", async () => {
    const { fetchImpl } = fakeFetch(() => [helpCenter]);
    const result = await runOperation(op("list"), {}, { profile, fetchImpl });
    expect(result).toEqual([
      { id: 1, name: "Docs", slug: "docs", is_active: true, default_locale: "en", updated_at: "2026-01-02T00:00:00Z" },
    ]);
  });

  it("collection_list present keeps the overview fields only", async () => {
    const { fetchImpl } = fakeFetch(() => [collection]);
    const result = await runOperation(op("collection_list"), { help_center_id: 1 }, { profile, fetchImpl });
    expect(result).toEqual([
      {
        id: 3,
        name: "Start",
        slug: "start",
        is_published: true,
        locale: "en",
        parent_id: null,
        sort_order: 2,
        updated_at: "2026-01-02T00:00:00Z",
      },
    ]);
  });

  it("tree present keeps article metadata and drops article content, also in children", async () => {
    const article = {
      id: 11,
      collection_id: 3,
      title: "Hello",
      slug: "hello",
      locale: "en",
      status: "published",
      ai_enabled: true,
      sort_order: 0,
      content: "<p>long body</p>",
      excerpt: "short",
    };
    const child = { ...collection, id: 4, parent_id: 3, article_count: 1, articles: [article], children: [] };
    const tree = [{ ...collection, article_count: 0, articles: [], children: [child] }];
    const { fetchImpl } = fakeFetch(() => ({ help_center: helpCenter, tree }));
    const result = (await runOperation(op("tree"), { id: 1 }, { profile, fetchImpl })) as {
      tree: { children: { articles: unknown[] }[] }[];
    };
    expect(result.tree[0]?.children[0]?.articles[0]).toEqual({
      id: 11,
      title: "Hello",
      slug: "hello",
      locale: "en",
      status: "published",
      ai_enabled: true,
      sort_order: 0,
    });
    expect(JSON.stringify(result)).not.toContain("long body");
    expect(JSON.stringify(result)).not.toContain("short");
  });
});
