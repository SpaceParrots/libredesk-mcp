/**
 * @module domains/articles
 * Knowledge base articles (LibreDesk `/api/v1/collections/{id}/articles` and `/api/v1/articles`).
 * Built from the LibreDesk 2.9.2 source, so every operation is undocumented. Content is written and
 * read as markdown by default; LibreDesk stores HTML.
 */

import { z } from "zod";
import { readArticleContent, toArticleHtml, type ContentFormat } from "../content/markdown.js";
import { forIds, idOrIds } from "../ops/bulk.js";
import { defineDomain, defineOperation } from "../ops/define.js";
import { mergeForUpdate } from "../ops/merge.js";
import { mcpSyncRoot, syncArticles } from "../services/article-sync.js";
import { ARTICLE_KEYS, NO_COLLECTION, presentArticleWrite } from "./article-record.js";

const PERMISSION = "help_center:manage";

const articleId = z.number().int().positive().describe("Article id.");
const collectionId = z.number().int().positive().describe("Collection id.");
const helpCenterId = z.number().int().positive().describe("Help center id.");

const formatField = z
  .enum(["markdown", "html"])
  .describe(
    '"markdown" (default) or "html" for what markdown cannot express, such as tables.',
  );

const title = z.string().describe("Article title.");
const content = z
  .string()
  .describe("Article body. A literal ~ reads back as &#126;; send it back as is.");

/** Optional fields shared by article create and update. */
const articleSettings = {
  locale: z.string().optional().describe("Locale code; must match the collection's locale."),
  excerpt: z.string().optional().describe("Short summary for lists and search."),
  meta_title: z.string().optional().describe("SEO title."),
  meta_description: z.string().optional().describe("SEO description."),
  meta_image_url: z.string().optional().describe("Social preview image URL."),
  sort_order: z.number().int().optional().describe("Position in the collection, lowest first."),
};

const aiEnabled = z.boolean().describe("Let AI assistants use it once published. True by default on create.");

const status = z.enum(["draft", "published"]).describe('"draft" (not public) or "published".');

const PUBLISH_EFFECT = "Publishing makes the article public, and AI-usable when ai_enabled is on.";

function asRecords(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => key in source).map((key) => [key, source[key]]));
}

function presentArticle(data: unknown, format: ContentFormat): Record<string, unknown> {
  const article = (data ?? {}) as Record<string, unknown>;
  const html = typeof article.content === "string" ? article.content : "";
  return { ...article, ...readArticleContent(html, format) };
}

interface TreeNode {
  readonly name?: unknown;
  readonly articles?: unknown;
  readonly children?: unknown;
}

function flattenTree(nodes: unknown, collectionFilter: number | undefined): Record<string, unknown>[] {
  return asRecords(nodes).flatMap((node) => {
    const { name, articles, children } = node as TreeNode;
    const own = asRecords(articles)
      .filter((a) => collectionFilter === undefined || a.collection_id === collectionFilter)
      .map((a) => ({
        collection_id: a.collection_id,
        collection_name: name,
        ...pick(a, ["id", "title", "slug", "locale", "status", "ai_enabled", "updated_at", "view_count", "helpful_count", "not_helpful_count"]),
      }));
    return [...own, ...flattenTree(children, collectionFilter)];
  });
}

interface VisibilityNode {
  readonly name?: unknown;
  readonly is_published?: unknown;
  readonly articles?: unknown;
  readonly children?: unknown;
}

/** Why an article is hidden from the AI assistants, or no reasons when they can use it. */
function hiddenReasons(article: Record<string, unknown>, unpublished: readonly string[], helpCenterActive: boolean): string[] {
  return [
    ...(article.status === "published" ? [] : [`status is ${String(article.status)}`]),
    ...(article.ai_enabled === true ? [] : ["ai_enabled is off"]),
    ...unpublished.map((name) => `collection "${name}" is unpublished`),
    ...(helpCenterActive ? [] : ["help center is offline"]),
  ];
}

/**
 * Walk the tree with the names of the unpublished collections on the way down, applying
 * LibreDesk's indexing rule (internal/ai/queries.sql, get-embeddable-help-articles).
 */
function visibilityOf(nodes: unknown, unpublishedAbove: readonly string[], helpCenterActive: boolean): Record<string, unknown>[] {
  return asRecords(nodes).flatMap((node) => {
    const { name, is_published: isPublished, articles, children } = node as VisibilityNode;
    const unpublished = isPublished === true ? unpublishedAbove : [...unpublishedAbove, String(name)];
    const own = asRecords(articles).map((a) => ({
      id: a.id,
      title: a.title,
      collection: name,
      reasons: hiddenReasons(a, unpublished, helpCenterActive),
    }));
    return [...own, ...visibilityOf(children, unpublished, helpCenterActive)];
  });
}

const visibility = defineOperation({
  name: "visibility",
  summary: "Which articles AI assistants can use, and why the others are hidden.",
  method: "GET",
  path: "/api/v1/help-centers/{help_center_id}/tree",
  input: { help_center_id: helpCenterId, locale: z.string().optional().describe("Only this locale; omit for all.") },
  query: ["locale"],
  positional: ["help_center_id"],
  impact: "read",
  permission: PERMISSION,
  undocumented: true,
  present: (data) => {
    const response = (data ?? {}) as { help_center?: Record<string, unknown>; tree?: unknown };
    const all = visibilityOf(response.tree, [], response.help_center?.is_active === true);
    const hidden = all.filter((a) => (a.reasons as string[]).length > 0);
    return {
      visible: all.length - hidden.length,
      hidden: hidden.length,
      visible_ids: all.filter((a) => (a.reasons as string[]).length === 0).map((a) => a.id),
      hidden_articles: hidden,
    };
  },
  cli: {
    notes: [
      "An article reaches the AI assistants only when it is published, ai_enabled is on, every collection above it is published and the help center is online. Prints the counts, the ids of the visible articles, and each hidden article with its reasons.",
      "LibreDesk re-indexes an article in the background right after a change, and checks every article again once a minute.",
    ],
    examples: ["ldesk articles visibility 2", "ldesk articles visibility 2 --locale de --json"],
  },
});

const list = defineOperation({
  name: "list",
  summary: "List a help center's articles, without content.",
  method: "GET",
  path: "/api/v1/help-centers/{help_center_id}/tree",
  input: {
    help_center_id: helpCenterId,
    locale: z.string().optional().describe('Only this locale; omit for all.'),
    collection_id: collectionId.optional().describe("Only this collection."),
  },
  positional: ["help_center_id"],
  impact: "read",
  permission: PERMISSION,
  undocumented: true,
  run: async (input, ctx) => {
    const response = await ctx.call<{ tree?: unknown }>("GET", `/api/v1/help-centers/${input.help_center_id}/tree`, {
      query: input.locale === undefined ? {} : { locale: input.locale },
    });
    return flattenTree(response?.tree, input.collection_id);
  },
  cli: {
    notes: [
      "Prints collection_id, collection_name, id, title, slug, locale, status, ai_enabled, updated_at and view counts; the table shows the first six, --json all of them.",
      "Content is left out: read it with `ldesk articles get <id>`.",
    ],
    examples: ["ldesk articles list 2", "ldesk articles list 2 --collection-id 7 --json"],
  },
});

const get = defineOperation({
  name: "get",
  summary: "Get one article with content and translations.",
  method: "GET",
  // LibreDesk looks the article up by id alone; the collection in the path is not used.
  path: "/api/v1/collections/0/articles/{id}",
  input: {
    id: articleId,
    format: formatField.default("markdown"),
  },
  positional: ["id"],
  impact: "read",
  permission: PERMISSION,
  undocumented: true,
  run: async (input, ctx) =>
    presentArticle(await ctx.call("GET", `/api/v1/collections/${NO_COLLECTION}/articles/${input.id}`), input.format),
  cli: {
    notes: ["Prints the whole article with its content as markdown; --format html prints the content as the stored HTML instead. Content markdown cannot express comes back as HTML with content_format: html."],
    examples: ["ldesk articles get 42", "ldesk articles get 42 --format html", "ldesk articles get 42 --json"],
  },
});

const create = defineOperation({
  name: "create",
  summary: "Create a draft article in a collection.",
  method: "POST",
  path: "/api/v1/collections/{collection_id}/articles",
  input: {
    collection_id: collectionId,
    title,
    content,
    format: formatField.default("markdown"),
    ...articleSettings,
    status: status.default("draft"),
    ai_enabled: aiEnabled.default(true),
  },
  positional: ["collection_id"],
  impact: "write",
  permission: PERMISSION,
  undocumented: true,
  run: (input, ctx) => {
    const { collection_id: collection, format, ...rest } = input;
    const body = { ...rest, content: toArticleHtml(input.content, format) };
    return ctx.call("POST", `/api/v1/collections/${collection}/articles`, { body });
  },
  present: presentArticleWrite,
  escalate: {
    when: (values) => values.status === "published",
    condition: "status is published",
    impact: "caution",
    effect: PUBLISH_EFFECT,
    fields: ["status"],
  },
  cli: {
    notes: [
      "Prints the new article's id, slug, status and ai_enabled, not its content.",
      "New articles are drafts. --status published makes the article public at once (asks for confirmation); AI assistants answer from published articles unless --no-ai-enabled is given.",
      'Without --locale the article is "en". For a collection in another locale pass its locale, which `ldesk help-center collection list <help-center-id>` prints.',
      "Read long content from a file with --content @file.md.",
    ],
    examples: [
      'ldesk articles create 7 --title "Refund policy" --content @refunds.md',
      'ldesk articles create 7 --title "Refund policy" --content @refunds.md --status published --yes',
      'ldesk articles create 7 --title "Price table" --content @prices.html --format html',
    ],
  },
});

const update = defineOperation({
  name: "update",
  summary: "Change only the given fields of an article.",
  method: "PUT",
  path: "/api/v1/articles/{id}",
  input: {
    id: articleId,
    title: title.optional(),
    content: content.optional(),
    format: formatField.default("markdown"),
    ...articleSettings,
    ai_enabled: aiEnabled.optional(),
  },
  positional: ["id"],
  impact: "write",
  permission: PERMISSION,
  undocumented: true,
  run: async (input, ctx) => {
    const current = await ctx.call<Record<string, unknown>>("GET", `/api/v1/collections/${NO_COLLECTION}/articles/${input.id}`);
    const changes = { ...input, content: input.content === undefined ? undefined : toArticleHtml(input.content, input.format) };
    const body = mergeForUpdate(current, changes, ARTICLE_KEYS);
    return ctx.call("PUT", `/api/v1/articles/${input.id}`, { body });
  },
  present: presentArticleWrite,
  cli: {
    notes: [
      "Only the given fields change. Publish or unpublish with `ldesk articles set-status`, move with `ldesk articles move`.",
      "The slug stays as it is, even when the title changes.",
    ],
    examples: ['ldesk articles update 42 --title "Refunds"', "ldesk articles update 42 --content @refunds.md", "ldesk articles update 42 --no-ai-enabled"],
  },
});

const sync = defineOperation({
  name: "sync",
  summary: "Create or update articles from local .md files with frontmatter; writes new ids back. Never changes status.",
  // A composite: it creates, reads, updates and moves articles through several endpoints.
  method: "PUT",
  path: "/api/v1/articles",
  input: {
    path: z.string().describe("A .md file or a folder of them; over MCP inside the server's folder."),
    collection_id: collectionId.optional(),
    dry_run: z.boolean().default(false).describe("Only report what would change."),
  },
  positional: ["path"],
  impact: "write",
  permission: PERMISSION,
  undocumented: true,
  run: (input, ctx) =>
    syncArticles({ path: input.path, collectionId: input.collection_id, dryRun: input.dry_run, ...(ctx.caller === "mcp" ? { root: mcpSyncRoot(), refuseMoves: true } : {}) }, ctx),
  cli: {
    notes: [
      "Each file holds one article. Frontmatter between --- lines sets the fields, one `key: value` per line: title, collection_id, excerpt, sort_order, ai_enabled, locale, meta_title, meta_description, meta_image_url, format (markdown or html), id. Without title, a leading `# heading` is the title. --collection-id is the collection for files without collection_id. A folder syncs its .md files, not its subfolders.",
      "A file without id creates a draft article, and sync writes `id: <new id>` into the file's frontmatter, so the next run updates that article. With id, the article is updated only when a field differs; a different collection_id moves it. Frontmatter keys you leave out keep their value on the server.",
      "Sync never publishes or unpublishes: publish afterwards with `ldesk articles set-status '[ids]' --status published --yes`. Prints counts and one line per file; --dry-run reports without writing to the server or the files.",
    ],
    examples: ["ldesk articles sync ./help --collection-id 7 --dry-run", "ldesk articles sync ./help --collection-id 7", "ldesk articles sync ./help/refunds.md"],
  },
});

const setStatus = defineOperation({
  name: "set_status",
  summary: "Publish articles or set them back to draft.",
  method: "PUT",
  path: "/api/v1/articles/{id}/status",
  input: { id: idOrIds("Article id or list of ids."), status },
  positional: ["id"],
  impact: "caution",
  effect: PUBLISH_EFFECT,
  permission: PERMISSION,
  undocumented: true,
  run: (input, ctx) =>
    forIds(input.id, async (id) => presentArticleWrite(await ctx.call("PUT", `/api/v1/articles/${id}/status`, { body: { status: input.status } }))),
  cli: {
    notes: ["Takes one id or a JSON list such as [42,43]. A list sets them one by one and prints ok, failed and an entry per id, so one failure does not stop the others."],
    examples: [
      "ldesk articles set-status 42 --status published --yes",
      "ldesk articles set-status '[42,43,44]' --status published --yes",
      "ldesk articles set-status 42 --status draft --yes",
    ],
  },
});

const move = defineOperation({
  name: "move",
  summary: "Move an article to another collection of its help center.",
  method: "PUT",
  path: "/api/v1/articles/{id}/collection",
  input: { id: articleId, collection_id: collectionId.describe("Target collection id.") },
  positional: ["id"],
  // The article keeps its status, and visibility follows the collections above it, so a move can make it public.
  impact: "caution",
  effect: "Can make a published article public and AI-visible.",
  permission: PERMISSION,
  undocumented: true,
  present: presentArticleWrite,
  cli: {
    notes: ["The target collection must belong to the article's help center. The article keeps its status."],
    examples: ["ldesk articles move 42 --collection-id 9 --yes"],
  },
});

const reorder = defineOperation({
  name: "reorder",
  summary: "Sort many articles of a collection at once.",
  method: "PUT",
  path: "/api/v1/collections/{collection_id}/article-sort-order",
  input: {
    collection_id: collectionId,
    order: z
      .record(z.string(), z.number().int())
      .describe('Map of article id to position, for example {"11":0,"14":1}.'),
  },
  positional: ["collection_id"],
  impact: "write",
  permission: PERMISSION,
  undocumented: true,
  run: (input, ctx) => ctx.call("PUT", `/api/v1/collections/${input.collection_id}/article-sort-order`, { body: input.order }),
  cli: { examples: ["ldesk articles reorder 7 --order '{\"42\":0,\"43\":1}'", "ldesk articles reorder 7 --order @order.json"] },
});

const linkable = defineOperation({
  name: "linkable",
  summary: "List articles linkable as translation: other locale, not yet linked.",
  method: "GET",
  path: "/api/v1/help-centers/{help_center_id}/linkable-articles",
  input: {
    help_center_id: helpCenterId,
    exclude_locale: z.string().describe('Locale of the article to link; articles in it are left out.'),
  },
  query: ["exclude_locale"],
  positional: ["help_center_id"],
  impact: "read",
  permission: PERMISSION,
  undocumented: true,
  cli: {
    notes: ["Pass the locale of the article you want to link; link one of the results with `ldesk articles link-translation`."],
    examples: ["ldesk articles linkable 2 --exclude-locale de"],
  },
});

const linkTranslation = defineOperation({
  name: "link_translation",
  summary: "Make an article a translation of another article.",
  method: "PUT",
  path: "/api/v1/articles/{id}/link-translation",
  input: { id: articleId, translation_of_id: articleId.describe("Id of the article this one translates.") },
  positional: ["id"],
  impact: "write",
  permission: PERMISSION,
  undocumented: true,
  cli: {
    notes: ["Find candidates with `ldesk articles linkable <help-center-id> --exclude-locale <locale of the article>`."],
    examples: ["ldesk articles link-translation 43 --translation-of-id 42"],
  },
});

const unlinkTranslation = defineOperation({
  name: "unlink_translation",
  summary: "Take an article out of its translation group.",
  method: "PUT",
  path: "/api/v1/articles/{id}/unlink-translation",
  input: { id: articleId },
  positional: ["id"],
  impact: "write",
  permission: PERMISSION,
  undocumented: true,
  cli: { examples: ["ldesk articles unlink-translation 43"] },
});

const remove = defineOperation({
  name: "delete",
  summary: "Delete an article.",
  method: "DELETE",
  // LibreDesk looks the article up by id alone; the collection in the path is not used.
  path: "/api/v1/collections/0/articles/{id}",
  input: { id: articleId },
  positional: ["id"],
  impact: "destructive",
  effect: "Deletes the article. Linked translations stay.",
  permission: PERMISSION,
  undocumented: true,
  cli: { examples: ["ldesk articles delete 42 --yes"] },
});

/** Knowledge base articles: one CLI command, one MCP tool. */
export const articlesDomain = defineDomain({
  name: "articles",
  tool: "libredesk_articles",
  actionPrefix: "article",
  toolset: "knowledge",
  summary: "Manage knowledge base articles, written and read as markdown.",
  operations: [list, visibility, get, create, update, sync, setStatus, move, reorder, linkable, linkTranslation, unlinkTranslation, remove],
});
