/**
 * @module domains/help-center
 * Help centers and their collections (LibreDesk `/api/v1/help-centers`). Built from the LibreDesk
 * 2.9.2 source, so every operation is undocumented. Articles live in their own domain.
 */

import { z } from "zod";
import { NotFoundError } from "../errors.js";
import { forIds, idOrIds } from "../ops/bulk.js";
import { defineDomain, defineOperation } from "../ops/define.js";
import { isRecord } from "../guards.js";
import { mergeForUpdate, requireList } from "../ops/merge.js";

const PERMISSION = "help_center:manage";

/** Shown before a collection goes public or offline. */
const COLLECTION_PUBLIC_EFFECT = "Changes what the public help center shows.";

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

const isPublished = z.boolean().describe("Publish the collection. New collections start unpublished.");

type Call = <T>(method: "GET", path: string) => Promise<T>;

async function listCollections(helpCenterId: number, call: Call): Promise<Record<string, unknown>[]> {
  return requireList(await call("GET", `/api/v1/help-centers/${helpCenterId}/collections`), "the collection list").filter(isRecord);
}

function findCollection(collections: readonly Record<string, unknown>[], helpCenterId: number, id: number): Record<string, unknown> {
  const current = collections.find((c) => c.id === id);
  if (current === undefined) {
    throw new NotFoundError(`Collection ${id} not found in help center ${helpCenterId}`, {
      status: 404,
      hint: "List the collections with `ldesk help-center collection list <help-center-id>` (MCP action collection_list).",
    });
  }
  return current;
}

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
  cli: {
    notes: ["Prints id, name, slug, is_active, default_locale and updated_at of each help center. Find a help center by its slug here."],
    examples: ["ldesk help-center list", "ldesk help-center list --json"],
  },
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
  cli: {
    notes: ["Help center ids come from `ldesk help-center list`."],
    examples: ["ldesk help-center get 2", "ldesk help-center get 2 --json"],
  },
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
  cli: { examples: ["ldesk help-center locales"] },
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
  cli: {
    notes: ["The result is nested; read it with --json. Article content is left out: use `ldesk articles get <id>`."],
    examples: ["ldesk help-center tree 2 --json", "ldesk help-center tree 2 --locale de --json"],
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
  cli: { examples: ["ldesk help-center insights 2 --json"] },
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
  cli: {
    notes: ["Repeat --allowed-locales once per locale. Locale codes come from `ldesk help-center locales`."],
    examples: [
      'ldesk help-center create --name Help --slug help --page-title "Acme Help"',
      'ldesk help-center create --name Docs --slug docs --page-title "Acme Docs" --default-locale de --allowed-locales de --allowed-locales en',
    ],
  },
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
  cli: {
    notes: ["Only the given settings change. --theme replaces the whole theme, so start from the theme in `ldesk help-center get <id> --json`."],
    examples: [
      'ldesk help-center update 2 --page-title "Acme Support"',
      "ldesk help-center update 2 --theme @theme.json",
      "ldesk help-center update 2 --livechat-inbox-id null",
    ],
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
  cli: {
    notes: ["Each call flips the state; is_active in `ldesk help-center list` shows the current one."],
    examples: ["ldesk help-center toggle 2 --yes"],
  },
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
  cli: { examples: ["ldesk help-center delete 2 --yes"] },
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
  cli: {
    notes: ["Prints id, name, slug, is_published, locale, parent_id, sort_order and updated_at; the table shows the first six, --json all of them."],
    examples: ["ldesk help-center collection list 2", "ldesk help-center collection list 2 --json"],
  },
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
  escalate: {
    when: (values) => values.is_published === true,
    condition: "is_published is true",
    impact: "caution",
    effect: COLLECTION_PUBLIC_EFFECT,
    fields: ["is_published"],
  },
  permission: PERMISSION,
  undocumented: true,
  cli: {
    notes: ["Help center ids come from `ldesk help-center list`, parent ids from `ldesk help-center collection list <help-center-id>`."],
    examples: [
      "ldesk help-center collection create 2 --name Billing --locale de",
      "ldesk help-center collection create 2 --name Billing --locale de --parent-id 5 --is-published --yes",
    ],
  },
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
  escalate: {
    when: (values) => values.is_published !== undefined,
    condition: "is_published is given",
    impact: "caution",
    effect: COLLECTION_PUBLIC_EFFECT,
    fields: ["is_published"],
  },
  permission: PERMISSION,
  undocumented: true,
  run: async (input, ctx) => {
    const current = findCollection(await listCollections(input.help_center_id, ctx.call), input.help_center_id, input.id);
    const body = mergeForUpdate(current, input, COLLECTION_KEYS);
    return ctx.call("PUT", `/api/v1/help-centers/${input.help_center_id}/collections/${input.id}`, { body });
  },
  cli: {
    notes: ["Takes the help center id, then the collection id. Only the given fields change."],
    examples: [
      'ldesk help-center collection update 2 5 --name "Billing and refunds"',
      "ldesk help-center collection update 2 5 --parent-id null",
      "ldesk help-center collection update 2 5 --no-is-published --yes",
    ],
  },
});

const collectionPublish = defineOperation({
  name: "collection_publish",
  group: "collection",
  summary: "Publish or unpublish collections.",
  method: "PUT",
  path: "/api/v1/help-centers/{help_center_id}/collections/{id}",
  input: {
    help_center_id: helpCenterId,
    id: idOrIds("Collection id or list of ids."),
    is_published: z.boolean().describe("true publishes, false unpublishes."),
  },
  positional: ["help_center_id", "id"],
  impact: "caution",
  effect: COLLECTION_PUBLIC_EFFECT,
  permission: PERMISSION,
  undocumented: true,
  run: async (input, ctx) => {
    const collections = await listCollections(input.help_center_id, ctx.call);
    return forIds(input.id, async (id) => {
      const body = mergeForUpdate(findCollection(collections, input.help_center_id, id), { is_published: input.is_published }, COLLECTION_KEYS);
      return presentCollection((await ctx.call("PUT", `/api/v1/help-centers/${input.help_center_id}/collections/${id}`, { body })) ?? {});
    });
  },
  cli: {
    notes: [
      "Takes the help center id, then one collection id or a JSON list such as [5,6]. A list prints ok, failed and an entry per id.",
      "An article reaches AI assistants only when every collection above it is published too.",
    ],
    examples: [
      "ldesk help-center collection publish 2 5 --is-published --yes",
      "ldesk help-center collection publish 2 '[5,6,7]' --is-published --yes",
      "ldesk help-center collection publish 2 5 --no-is-published --yes",
    ],
    flags: { is_published: { on: "Publish the collections.", off: "Unpublish the collections." } },
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
  effect: COLLECTION_PUBLIC_EFFECT,
  permission: PERMISSION,
  undocumented: true,
  // Flipping without knowing the state misleads a model; MCP gets collection_publish instead.
  mcp: false,
  cli: {
    notes: ["Each call flips is_published. To set a known state, use `ldesk help-center collection publish <help-center-id> <id> --is-published` or `--no-is-published`."],
    examples: ["ldesk help-center collection toggle 5 --yes"],
  },
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
  cli: {
    examples: [
      "ldesk help-center collection reorder 2 --order '{\"5\":0,\"3\":1}'",
      "ldesk help-center collection reorder 2 --order @order.json",
    ],
  },
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
  cli: {
    notes: ["Takes the help center id, then the collection id."],
    examples: ["ldesk help-center collection delete 2 9 --yes"],
  },
});

/** Help centers and their collections: one CLI command, one MCP tool. */
export const helpCenterDomain = defineDomain({
  name: "help-center",
  tool: "libredesk_help_center",
  actionPrefix: "help_center",
  toolset: "knowledge",
  summary: "Manage help centers and their collections.",
  groups: { collection: "Manage the collections of a help center, the sections that hold its articles." },
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
    collectionPublish,
    collectionToggle,
    collectionReorder,
    collectionDelete,
  ],
});
