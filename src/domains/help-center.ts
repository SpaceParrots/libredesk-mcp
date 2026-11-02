/**
 * @module domains/help-center
 * Help centers and their collections (LibreDesk `/api/v1/help-centers`). Built from the LibreDesk
 * 2.9.2 source, so every operation is undocumented. Articles live in their own domain.
 */

import { z } from "zod";
import { NotFoundError } from "../errors.js";
import { defineDomain, defineOperation } from "../ops/define.js";
import { mergeForUpdate } from "../ops/merge.js";

const PERMISSION = "help_center:manage";

/** Keys of LibreDesk's `HelpCenterRequest`: the body of a help center create or update. */
const HELP_CENTER_KEYS = [
  "name",
  "slug",
  "page_title",
  "meta_description",
  "custom_css",
  "custom_js",
  "default_locale",
  "allowed_locales",
  "theme",
  "custom_domain",
  "template",
  "livechat_inbox_id",
] as const;

/** Keys of LibreDesk's `CollectionRequest`: the body of a collection create or update. */
const COLLECTION_KEYS = [
  "slug",
  "parent_id",
  "locale",
  "name",
  "description",
  "icon",
  "sort_order",
  "is_published",
] as const;

const helpCenterId = z.number().int().positive().describe("Numeric id of the help center. Find it with the list action.");
const collectionId = z.number().int().positive().describe("Numeric id of the collection. Find it with collection_list or tree.");

const name = z.string().describe("Display name of the help center, shown in the admin UI. Required, not empty.");
const slug = z
  .string()
  .describe(
    "URL slug of the public help center (/hc/<slug>). Lowercase letters, digits, hyphen and underscore only, up to 200 characters, unique. Not allowed: articles, search, api, sitemap.xml.",
  );
const pageTitle = z.string().describe("Title shown on the public help center pages and in the browser tab. Required, not empty.");

/** Optional settings shared by help center create and update. */
const helpCenterSettings = {
  meta_description: z.string().optional().describe("Meta description for search engines, up to 500 characters."),
  default_locale: z
    .string()
    .optional()
    .describe('Locale code the help center is shown in by default, for example "en" or "de". Must be a code from the locales action. Defaults to "en".'),
  allowed_locales: z
    .array(z.string())
    .optional()
    .describe(
      'Locale codes the help center can be authored in, for example ["en", "de"]. Codes come from the locales action. The default locale is always included. Locales that already have articles cannot be removed.',
    ),
  theme: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Branding object, for example {"color":"#1f93ff","color_scheme":"system","tagline":"..."}. Other keys: color_dark, logo_url, favicon, header, footer, nav_links, social_links, layout, cards, article, announcement. Replaces the whole theme: read it with get first and send the full object.',
    ),
  custom_domain: z
    .string()
    .optional()
    .describe('Own domain serving the help center, as origin only: "https://help.example.com" (no path, no trailing slash). Empty string removes it.'),
  template: z.enum(["docs", "classic"]).optional().describe('Page layout of the public help center: "classic" (default) or "docs".'),
  custom_css: z.string().optional().describe("Extra CSS added to every public page."),
  custom_js: z.string().optional().describe("Extra JavaScript added to every public page."),
  livechat_inbox_id: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe("Id of a live chat inbox to show as chat widget on the public pages. Null removes the widget. Must be an inbox with the live chat channel."),
};

/** Optional settings shared by collection create and update. */
const collectionSettings = {
  slug: z
    .string()
    .optional()
    .describe("Ignored by LibreDesk 2.9.2: the slug is generated from the name on create and kept unchanged on update."),
  parent_id: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe("Id of the parent collection to nest under, up to 3 levels deep. Null makes it a top-level collection."),
  locale: z.string().optional().describe('Locale code of the collection, for example "en". Must be one of the help center\'s allowed locales.'),
  description: z.string().optional().describe("Short text shown under the collection name on the public help center."),
  icon: z.string().optional().describe('Lucide icon name in kebab-case, for example "rocket" or "user-check". Letters, digits and hyphen only.'),
  sort_order: z.number().int().optional().describe("Position among sibling collections, lowest first. Use collection_reorder to set many at once."),
};

const isPublished = z.boolean().describe("Whether the collection is visible on the public help center. Defaults to false (draft).");

const getHelpCenter = (id: number, call: <T>(method: "GET", path: string) => Promise<T>) =>
  call<Record<string, unknown>>("GET", `/api/v1/help-centers/${id}`);

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => key in source).map((key) => [key, source[key]]));
}

function asRecords(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

function presentCollection(c: Record<string, unknown>): Record<string, unknown> {
  return pick(c, ["id", "name", "slug", "is_published", "locale", "parent_id", "sort_order", "updated_at"]);
}

function presentArticle(a: Record<string, unknown>): Record<string, unknown> {
  return pick(a, ["id", "title", "slug", "locale", "status", "ai_enabled", "sort_order"]);
}

function presentTreeCollection(c: Record<string, unknown>): Record<string, unknown> {
  return {
    ...presentCollection(c),
    article_count: c.article_count,
    articles: asRecords(c.articles).map(presentArticle),
    children: asRecords(c.children).map(presentTreeCollection),
  };
}

const list = defineOperation({
  name: "list",
  summary: "List all help centers.",
  method: "GET",
  path: "/api/v1/help-centers",
  input: {},
  impact: "read",
  permission: PERMISSION,
  undocumented: true,
  present: (data) =>
    asRecords(data).map((hc) => pick(hc, ["id", "name", "slug", "is_active", "default_locale", "updated_at"])),
});

const get = defineOperation({
  name: "get",
  summary: "Get one help center with its full settings, theme included.",
  method: "GET",
  path: "/api/v1/help-centers/{id}",
  input: { id: helpCenterId },
  positional: ["id"],
  impact: "read",
  permission: PERMISSION,
  undocumented: true,
});

const locales = defineOperation({
  name: "locales",
  summary: "List the locale codes a help center can use.",
  method: "GET",
  path: "/api/v1/help-centers/locales",
  input: {},
  impact: "read",
  permission: PERMISSION,
  undocumented: true,
});

const tree = defineOperation({
  name: "tree",
  summary: "Show the collections and articles of a help center as a tree, without article content.",
  method: "GET",
  path: "/api/v1/help-centers/{id}/tree",
  input: {
    id: helpCenterId,
    locale: z.string().optional().describe('Only return collections and articles in this locale, for example "en". Omit for all locales.'),
  },
  query: ["locale"],
  positional: ["id"],
  impact: "read",
  permission: PERMISSION,
  undocumented: true,
  present: (data) => {
    const response = (data ?? {}) as { help_center?: Record<string, unknown>; tree?: unknown };
    return {
      help_center: pick(response.help_center ?? {}, ["id", "name", "slug", "default_locale"]),
      tree: asRecords(response.tree).map(presentTreeCollection),
    };
  },
});

const insights = defineOperation({
  name: "insights",
  summary: "Show search analytics of the public help center: top search terms and searches without results.",
  method: "GET",
  path: "/api/v1/help-centers/{id}/insights",
  input: { id: helpCenterId },
  positional: ["id"],
  impact: "read",
  permission: PERMISSION,
  undocumented: true,
});

const create = defineOperation({
  name: "create",
  summary: "Create a help center.",
  method: "POST",
  path: "/api/v1/help-centers",
  input: { name, slug, page_title: pageTitle, ...helpCenterSettings },
  impact: "write",
  permission: PERMISSION,
  undocumented: true,
});

const update = defineOperation({
  name: "update",
  summary: "Change settings of a help center. Fields you leave out keep their value.",
  method: "PUT",
  path: "/api/v1/help-centers/{id}",
  input: {
    id: helpCenterId,
    name: name.optional(),
    slug: slug.optional(),
    page_title: pageTitle.optional(),
    ...helpCenterSettings,
  },
  positional: ["id"],
  impact: "write",
  permission: PERMISSION,
  undocumented: true,
  run: async (input, ctx) => {
    const current = await getHelpCenter(input.id, ctx.call);
    const body = mergeForUpdate(current, input, HELP_CENTER_KEYS);
    return ctx.call("PUT", `/api/v1/help-centers/${input.id}`, { body });
  },
});

const toggle = defineOperation({
  name: "toggle",
  summary: "Switch a help center between online and offline.",
  method: "PUT",
  path: "/api/v1/help-centers/{id}/toggle",
  input: { id: helpCenterId },
  positional: ["id"],
  impact: "caution",
  effect: "Takes the public help center online or offline.",
  permission: PERMISSION,
  undocumented: true,
});

const remove = defineOperation({
  name: "delete",
  summary: "Delete a help center.",
  method: "DELETE",
  path: "/api/v1/help-centers/{id}",
  input: { id: helpCenterId },
  positional: ["id"],
  impact: "destructive",
  effect: "Deletes the help center with all its collections and articles.",
  permission: PERMISSION,
  undocumented: true,
});

const collectionList = defineOperation({
  name: "collection_list",
  group: "collection",
  summary: "List the collections of a help center.",
  method: "GET",
  path: "/api/v1/help-centers/{help_center_id}/collections",
  input: { help_center_id: helpCenterId },
  positional: ["help_center_id"],
  impact: "read",
  permission: PERMISSION,
  undocumented: true,
  present: (data) => asRecords(data).map(presentCollection),
});

const collectionCreate = defineOperation({
  name: "collection_create",
  group: "collection",
  summary: "Create a collection in a help center.",
  method: "POST",
  path: "/api/v1/help-centers/{help_center_id}/collections",
  input: {
    help_center_id: helpCenterId,
    name: z.string().describe("Name of the collection, shown on the public help center. Required, not empty."),
    ...collectionSettings,
    is_published: isPublished.default(false),
  },
  positional: ["help_center_id"],
  impact: "write",
  permission: PERMISSION,
  undocumented: true,
});

const collectionUpdate = defineOperation({
  name: "collection_update",
  group: "collection",
  summary: "Change a collection. Fields you leave out keep their value.",
  method: "PUT",
  path: "/api/v1/help-centers/{help_center_id}/collections/{id}",
  input: {
    help_center_id: helpCenterId,
    id: collectionId,
    name: z.string().optional().describe("New name of the collection. Not empty."),
    ...collectionSettings,
    is_published: isPublished.optional(),
  },
  positional: ["help_center_id", "id"],
  impact: "write",
  permission: PERMISSION,
  undocumented: true,
  run: async (input, ctx) => {
    const collections = asRecords(await ctx.call("GET", `/api/v1/help-centers/${input.help_center_id}/collections`));
    const current = collections.find((c) => c.id === input.id);
    if (current === undefined) {
      throw new NotFoundError(`Collection ${input.id} not found in help center ${input.help_center_id}`, {
        status: 404,
        hint: "List the collections with collection_list.",
      });
    }
    const body = mergeForUpdate(current, input, COLLECTION_KEYS);
    return ctx.call("PUT", `/api/v1/help-centers/${input.help_center_id}/collections/${input.id}`, { body });
  },
});

const collectionToggle = defineOperation({
  name: "collection_toggle",
  group: "collection",
  summary: "Publish or unpublish a collection.",
  method: "PUT",
  path: "/api/v1/collections/{id}/toggle",
  input: { id: collectionId },
  positional: ["id"],
  impact: "caution",
  effect: "Publishes or unpublishes the collection on the public help center.",
  permission: PERMISSION,
  undocumented: true,
});

const collectionReorder = defineOperation({
  name: "collection_reorder",
  group: "collection",
  summary: "Set the sort order of several collections at once.",
  method: "PUT",
  path: "/api/v1/help-centers/{help_center_id}/collection-sort-order",
  input: {
    help_center_id: helpCenterId,
    order: z
      .record(z.string(), z.number().int())
      .describe('Map of collection id to position, lowest first, for example {"3":0,"5":1}. Keys are collection ids as strings.'),
  },
  positional: ["help_center_id"],
  impact: "write",
  permission: PERMISSION,
  undocumented: true,
  run: (input, ctx) =>
    ctx.call("PUT", `/api/v1/help-centers/${input.help_center_id}/collection-sort-order`, { body: input.order }),
});

const collectionDelete = defineOperation({
  name: "collection_delete",
  group: "collection",
  summary: "Delete a collection.",
  method: "DELETE",
  path: "/api/v1/help-centers/{help_center_id}/collections/{id}",
  input: { help_center_id: helpCenterId, id: collectionId },
  positional: ["help_center_id", "id"],
  impact: "destructive",
  effect: "Deletes the collection and the articles in it.",
  permission: PERMISSION,
  undocumented: true,
});

/** Help centers and their collections: one CLI command, one MCP tool. */
export const helpCenterDomain = defineDomain({
  name: "help-center",
  tool: "libredesk_help_center",
  toolset: "knowledge",
  summary: "Manage help centers and their collections.",
  operations: [
    list,
    get,
    locales,
    tree,
    insights,
    create,
    update,
    toggle,
    remove,
    collectionList,
    collectionCreate,
    collectionUpdate,
    collectionToggle,
    collectionReorder,
    collectionDelete,
  ],
});
