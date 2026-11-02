import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Profile } from "../../src/config.js";
import { markdownToHtml } from "../../src/content/markdown.js";
import type { OperationContext } from "../../src/ops/define.js";
import { readLocalArticle, syncArticles, type SyncFs } from "../../src/services/article-sync.js";

const profile: Profile = { name: "t", url: "https://ex.com", apiKey: "key", apiSecret: "secret" };
const DIR = resolve("help-folder");

interface Call {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

function memoryFs(files: Record<string, string>, failWrites = false): { fs: SyncFs; files: Map<string, string> } {
  const store = new Map(Object.entries(files).map(([name, text]) => [join(DIR, name), text]));
  return {
    files: store,
    fs: {
      readFile: (path) => {
        const text = store.get(path);
        return text === undefined ? Promise.reject(new Error(`no file ${path}`)) : Promise.resolve(text);
      },
      writeFile: (path, text) => {
        if (failWrites) return Promise.reject(new Error("read-only"));
        store.set(path, text);
        return Promise.resolve();
      },
      readdir: () => Promise.resolve([...store.keys()].map((path) => path.slice(DIR.length + 1))),
      isDirectory: (path) => Promise.resolve(path === DIR),
    },
  };
}

function server(articles: Record<number, Record<string, unknown>>): { ctx: OperationContext; calls: Call[] } {
  const calls: Call[] = [];
  let nextId = 100;
  const call = (method: string, path: string, opts: { body?: unknown } = {}): Promise<never> => {
    calls.push({ method, path, body: opts.body });
    const id = Number(/articles\/(\d+)/.exec(path)?.[1]);
    if (method === "GET") {
      const article = articles[id];
      if (article === undefined) return Promise.reject(new Error(`Article ${id} not found`));
      return Promise.resolve(article as never);
    }
    if (method === "POST") return Promise.resolve({ id: ++nextId } as never);
    return Promise.resolve({ id } as never);
  };
  return { ctx: { profile, call: call as OperationContext["call"] }, calls };
}

const stored = (id: number, title: string, markdown: string, extra: Record<string, unknown> = {}) => ({
  id,
  collection_id: 7,
  title,
  content: markdownToHtml(markdown),
  status: "published",
  ai_enabled: true,
  author_id: 1,
  ...extra,
});

describe("readLocalArticle", () => {
  it("takes the title from a leading heading when the frontmatter has none, and drops it from the body", () => {
    expect(readLocalArticle("# Refunds\n\nText")).toMatchObject({ title: "Refunds", content: "Text", format: "markdown", settings: {} });
  });

  it("names status as unknown and points to set_status", () => {
    expect(() => readLocalArticle("---\ntitle: T\nstatus: published\n---\nx")).toThrow(/Sync never publishes/);
  });

  it("rejects a file without a title, and wrongly typed values", () => {
    expect(() => readLocalArticle("Just text")).toThrow(/no title/);
    expect(() => readLocalArticle("---\ntitle: T\nai_enabled: yes\n---\nx")).toThrow(/ai_enabled must be true or false/);
    expect(() => readLocalArticle("---\ntitle: T\nid: abc\n---\nx")).toThrow(/id must be a whole number/);
  });
});

describe("syncArticles", () => {
  it("creates new files as drafts and writes the id back, updates changed ones, leaves the rest", async () => {
    const { fs, files } = memoryFs({
      "a-new.md": "---\nexcerpt: Short\n---\n# New one\n\nHello **there**",
      "b-same.md": "---\nid: 5\ntitle: Same\n---\n* one\n* two\n",
      "c-changed.md": "---\nid: 6\ntitle: Changed title\n---\nBody",
      "notes.txt": "ignored",
    });
    const { ctx, calls } = server({
      5: stored(5, "Same", "- one\n- two", { content: '<ul><li>one</li><li>two</li></ul>' }),
      6: stored(6, "Old title", "Body", { excerpt: "keep me" }),
    });
    const result = await syncArticles({ path: DIR, collectionId: 7, dryRun: false }, ctx, fs);
    expect(result).toEqual({
      created: 1,
      updated: 1,
      unchanged: 1,
      failed: 0,
      files: [
        { file: "a-new.md", action: "created", id: 101 },
        { file: "b-same.md", action: "unchanged", id: 5 },
        { file: "c-changed.md", action: "updated", id: 6, changed: ["title"] },
      ],
    });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /api/v1/collections/7/articles",
      "GET /api/v1/collections/0/articles/5",
      "GET /api/v1/collections/0/articles/6",
      "PUT /api/v1/articles/6",
    ]);
    expect(calls[0]?.body).toMatchObject({ title: "New one", excerpt: "Short", status: "draft", ai_enabled: true });
    expect((calls[0]?.body as { content: string }).content).toContain("<strong>there</strong>");
    expect(calls[3]?.body).toMatchObject({ title: "Changed title", excerpt: "keep me", status: "published", author_id: 1 });
    expect(files.get(join(DIR, "a-new.md"))).toBe("---\nid: 101\nexcerpt: Short\n---\n# New one\n\nHello **there**");
  });

  it("writes nothing on a dry run", async () => {
    const { fs, files } = memoryFs({ "a.md": "# A\n\nx", "b.md": "---\nid: 6\ntitle: New\n---\nBody" });
    const before = new Map(files);
    const { ctx, calls } = server({ 6: stored(6, "Old", "Body") });
    const result = await syncArticles({ path: DIR, collectionId: 7, dryRun: true }, ctx, fs);
    expect(result.files).toEqual([
      { file: "a.md", action: "would create" },
      { file: "b.md", action: "would update", id: 6, changed: ["title"] },
    ]);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(files).toEqual(before);
  });

  it("moves an article whose collection_id changed, without rewriting it", async () => {
    const { fs } = memoryFs({ "a.md": "---\nid: 6\ntitle: T\ncollection_id: 9\n---\nBody" });
    const { ctx, calls } = server({ 6: stored(6, "T", "Body") });
    const result = await syncArticles({ path: DIR, dryRun: false }, ctx, fs);
    expect(result.files).toEqual([{ file: "a.md", action: "moved", id: 6, changed: ["collection_id"] }]);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /api/v1/collections/0/articles/6", "PUT /api/v1/articles/6/collection"]);
    expect(calls[1]?.body).toEqual({ collection_id: 9 });
  });

  it("reports failing files and keeps going", async () => {
    const { fs } = memoryFs({
      "a.md": "---\nid: 6\ntitle: T\n---\nBody",
      "b.md": "---\nid: 6\ntitle: Twin\n---\nBody",
      "c.md": "# No collection\n\nx",
      "d.md": "---\nid: 404\ntitle: Gone\n---\nx",
      "e.md": "# Fine\n\nx\n",
    });
    const { ctx } = server({ 6: stored(6, "T", "Body") });
    const result = await syncArticles({ path: DIR, dryRun: false }, ctx, fs);
    expect(result).toMatchObject({ created: 0, unchanged: 1, failed: 4 });
    expect(result.files.map((f) => [f.file, f.action, f.error ?? ""])).toEqual([
      ["a.md", "unchanged", ""],
      ["b.md", "failed", "id 6 is also in a.md"],
      ["c.md", "failed", expect.stringContaining("no collection") as unknown],
      ["d.md", "failed", expect.stringContaining("Article 404 not found") as unknown],
      ["e.md", "failed", expect.stringContaining("no collection") as unknown],
    ]);
  });

  it("says which id was created when the file cannot take it", async () => {
    const { fs } = memoryFs({ "a.md": "# A\n\nx" }, true);
    const { ctx } = server({});
    const result = await syncArticles({ path: DIR, collectionId: 7, dryRun: false }, ctx, fs);
    expect(result.files[0]).toMatchObject({ action: "failed", error: expect.stringContaining('add "id: 101" by hand') as unknown });
  });

  it("syncs a single file and rejects other file types", async () => {
    const { fs } = memoryFs({ "a.md": "---\nid: 6\ntitle: T\n---\nBody" });
    const { ctx } = server({ 6: stored(6, "T", "Body") });
    const single = await syncArticles({ path: join(DIR, "a.md"), dryRun: false }, ctx, fs);
    expect(single.files).toEqual([{ file: "a.md", action: "unchanged", id: 6 }]);
    await expect(syncArticles({ path: join(DIR, "a.txt"), dryRun: false }, ctx, fs)).rejects.toThrow(/not a .md file/);
  });
});
