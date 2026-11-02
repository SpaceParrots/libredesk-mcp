/**
 * @module domains/articles
 * Knowledge base articles (LibreDesk `/api/v1/collections/{id}/articles` and `/api/v1/articles`).
 * Built from the LibreDesk 2.9.2 source, so every operation is undocumented. Content is written and
 * read as markdown by default; LibreDesk stores HTML.
 */

import { z } from "zod";
import { readArticleContent, toArticleHtml, type ContentFormat } from "../content/markdown.js";
import { defineDomain, defineOperation } from "../ops/define.js";
import { mergeForUpdate } from "../ops/merge.js";

const PERMISSION = "help_center:manage";

/**
 * Keys of LibreDesk's `ArticleRequest` that an update writes, except `collection_id` (moving is
 * `move`). `status` and `author_id` are not caller inputs but must be sent back: the update SQL
 * writes both, an empty status becomes `draft` and a missing author is cleared.
 */
const ARTICLE_KEYS = [
  "slug",
  "locale",
  "title",
  "content",
  "excerpt",
  "meta_title",
  "meta_description",
  "meta_image_url",
  "sort_order",
  "status",
  "ai_enabled",
  "author_id",
] as const;

const NO_COLLECTION = 0;

const articleId = z.number().int().positive().describe("Article id.");
const collectionId = z.number().int().positive().describe("Collection id.");
const helpCenterId = z.number().int().positive().describe("Help center id.");

const formatField = z
  .enum(["markdown", "html"])
  .describe(
    '"markdown" (default) or "html" for what markdown cannot express, such as tables.',
  );

const pathCollectionId = z
  .number()
  .int()
  .default(NO_COLLECTION)
  .describe("LibreDesk ignores it (lookup by id); leave it out.");

const title = z.string().describe("Article title.");
const content = z
  .string()
  .describe(
    "Article body. In markdown a literal tilde reads as &#126;; write it back as is. ~~x~~ is strikethrough.",
  );

/** Optional fields shared by article create and update. */
const articleSettings = {
  slug: z.string().optional().describe("Ignored; LibreDesk makes the slug from the title."),
  locale: z.string().optional().describe("Locale code; must match the collection's locale."),
  excerpt: z.string().optional().describe("Short summary for lists and search."),
  meta_title: z.string().optional().describe("SEO title."),
  meta_description: z.string().optional().describe("SEO description."),
  meta_image_url: z.string().optional().describe("Social preview image URL."),
  sort_order: z.number().int().optional().describe("Position in the collection, lowest first."),
};

const aiEnabled = z
  .boolean()
  .describe(
    "Let AI assistants answer from it once published. True by default on create; update keeps it unless given.",
  );

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
  path: "/api/v1/collections/{collection_id}/articles/{id}",
  input: {
    id: articleId,
    collection_id: pathCollectionId,
    format: formatField.default("markdown"),
  },
  positional: ["id"],
  impact: "read",
  permission: PERMISSION,
  undocumented: true,
  run: async (input, ctx) =>
    presentArticle(await ctx.call("GET", `/api/v1/collections/${input.collection_id}/articles/${input.id}`), input.format),
  cli: {
    notes: ["Prints the whole article with its content as markdown; --format html prints the content as the stored HTML instead. Content markdown cannot express comes back as HTML with content_format: html."],
    examples: ["ldesk articles get 42", "ldesk articles get 42 --format html", "ldesk articles get 42 --json"],
    hidden: ["collection_id"],
  },
});

const create = defineOperation({
  name: "create",
  summary: "Create an article in a collection, as draft unless status is published.",
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
  escalate: { when: (values) => values.status === "published", condition: "status is published", impact: "caution", effect: PUBLISH_EFFECT },
  cli: {
    notes: [
      "New articles are drafts. --status published makes the article public at once (asks for confirmation); AI assistants answer from published articles unless --no-ai-enabled is given.",
      'Without --locale the article is "en". For a collection in another locale pass its locale, which `ldesk help-center collection list <help-center-id>` prints.',
      "Read long content from a file with --content @file.md.",
    ],
    hidden: ["slug"],
    examples: [
      'ldesk articles create 7 --title "Refund policy" --content @refunds.md',
      'ldesk articles create 7 --title "Refund policy" --content @refunds.md --status published --yes',
      'ldesk articles create 7 --title "Price table" --content @prices.html --format html',
    ],
  },
});

const update = defineOperation({
  name: "update",
  summary: "Change only the given fields of an article. Publish with set_status, move with move.",
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
  cli: {
    notes: ["Only the given fields change. Publish or unpublish with `ldesk articles set-status`, move with `ldesk articles move`."],
    examples: ['ldesk articles update 42 --title "Refunds"', "ldesk articles update 42 --content @refunds.md", "ldesk articles update 42 --no-ai-enabled"],
    hidden: ["slug"],
  },
});

const setStatus = defineOperation({
  name: "set_status",
  summary: "Publish an article or set it back to draft.",
  method: "PUT",
  path: "/api/v1/articles/{id}/status",
  input: { id: articleId, status },
  positional: ["id"],
  impact: "caution",
  effect: PUBLISH_EFFECT,
  permission: PERMISSION,
  undocumented: true,
  cli: { examples: ["ldesk articles set-status 42 --status published --yes", "ldesk articles set-status 42 --status draft --yes"] },
});

const move = defineOperation({
  name: "move",
  summary: "Move an article to another collection of its help center.",
  method: "PUT",
  path: "/api/v1/articles/{id}/collection",
  input: { id: articleId, collection_id: collectionId.describe("Target collection id.") },
  positional: ["id"],
  impact: "write",
  permission: PERMISSION,
  undocumented: true,
  cli: {
    notes: ["The target collection must belong to the article's help center."],
    examples: ["ldesk articles move 42 --collection-id 9"],
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
  path: "/api/v1/collections/{collection_id}/articles/{id}",
  input: { id: articleId, collection_id: pathCollectionId },
  positional: ["id"],
  impact: "destructive",
  effect: "Deletes the article. Linked translations stay.",
  permission: PERMISSION,
  undocumented: true,
  cli: { examples: ["ldesk articles delete 42 --yes"], hidden: ["collection_id"] },
});

/** Knowledge base articles: one CLI command, one MCP tool. */
export const articlesDomain = defineDomain({
  name: "articles",
  tool: "libredesk_articles",
  toolset: "knowledge",
  summary: "Manage knowledge base articles, written and read as markdown.",
  operations: [list, get, create, update, setStatus, move, reorder, linkable, linkTranslation, unlinkTranslation, remove],
});
