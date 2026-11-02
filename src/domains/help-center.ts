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

const helpCenterId = z.number().int().positive().describe("Help center id.");
const collectionId = z.number().int().positive().describe("Collection id.");

const name = z.string().describe("Help center name.");
const slug = z
  .string()
  .describe(
    "URL slug (/hc/<slug>): unique; a-z, 0-9, - and _; not articles, search, api, sitemap.xml.",
  );
const pageTitle = z.string().describe("Title of the public pages.");

/** Optional settings shared by help center create and update. */
const helpCenterSettings = {
  meta_description: z.string().optional().describe("SEO description, up to 500 characters."),
  default_locale: z
    .string()
    .optional()
    .describe('Default locale code (from locales); "en" when unset.'),
  allowed_locales: z
    .array(z.string())
    .optional()
    .describe(
      'Locale codes (from locales) content can use; ones with articles cannot be removed.',
    ),
  theme: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Branding object such as {"color":"#1f93ff"}. Replaces the whole theme: send the full object from get.',
    ),
  custom_domain: z
    .string()
    .optional()
    .describe('Own domain origin such as "https://help.example.com"; "" removes it.'),
  template: z.enum(["docs", "classic"]).optional().describe('Page layout, "classic" by default.'),
  custom_css: z.string().optional().describe("Extra CSS for the public pages."),
  custom_js: z.string().optional().describe("Extra JavaScript for the public pages."),
  livechat_inbox_id: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe("Live chat inbox for the public chat widget; null removes it."),
};

/** Optional settings shared by collection create and update. */
const collectionSettings = {
  slug: z
    .string()
    .optional()
    .describe("Ignored."),
  parent_id: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe("Parent collection id (max 3 levels); null for top level."),
  locale: z.string().optional().describe('Locale code, for example "en".'),
  description: z.string().optional().describe("Short text under the collection name."),
  icon: z.string().optional().describe('Lucide icon name, for example "rocket".'),
  sort_order: z.number().int().optional().describe("Position among siblings, lowest first."),
};

const collectionName = z.string().describe("Collection name.");

const isPublished = z.boolean().describe("Public visibility; new collections default to false.");

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
  summary: "Get one help center with all settings and theme.",
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
  summary: "Collections and articles of a help center as a tree, without content.",
  method: "GET",
  path: "/api/v1/help-centers/{id}/tree",
  input: {
    id: helpCenterId,
    locale: z.string().optional().describe('Only this locale; omit for all.'),
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
  summary: "Top and zero-result search terms of the public help center.",
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
  summary: "Change only the given settings of a help center.",
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
  summary: "Take a help center online or offline.",
  method: "PUT",
  path: "/api/v1/help-centers/{id}/toggle",
  input: { id: helpCenterId },
  positional: ["id"],
  impact: "caution",
  effect: "Changes what the public sees.",
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
  effect: "Deletes it with all its collections and articles.",
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
    name: collectionName,
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
  summary: "Change only the given fields of a collection.",
  method: "PUT",
  path: "/api/v1/help-centers/{help_center_id}/collections/{id}",
  input: {
    help_center_id: helpCenterId,
    id: collectionId,
    name: collectionName.optional(),
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
  effect: "Changes what the public help center shows.",
  permission: PERMISSION,
  undocumented: true,
});

const collectionReorder = defineOperation({
  name: "collection_reorder",
  group: "collection",
  summary: "Sort many collections at once.",
  method: "PUT",
  path: "/api/v1/help-centers/{help_center_id}/collection-sort-order",
  input: {
    help_center_id: helpCenterId,
    order: z
      .record(z.string(), z.number().int())
      .describe('Map of collection id to position, for example {"3":0,"5":1}.'),
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
  effect: "Deletes it and its articles.",
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
