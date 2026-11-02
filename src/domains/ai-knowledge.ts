/**
 * @module domains/ai-knowledge
 * The knowledge the AI assistants answer from: snippets, FAQ suggestions mined from resolved
 * conversations, and the FAQ learning switch (LibreDesk `/api/v1/ai/snippets`, `/api/v1/ai/faq-suggestions`,
 * `/api/v1/ai/faq-learning`). Built from the LibreDesk 2.9.2 source, so every operation is undocumented.
 * Snippet content is plain text.
 */

import { z } from "zod";
import { NotFoundError } from "../errors.js";
import { defineDomain, defineOperation } from "../ops/define.js";
import { isRecord } from "../guards.js";
import { mergeForUpdate, requireList } from "../ops/merge.js";

const PERMISSION = "ai:manage";

/** Keys of LibreDesk's `snippetReq`. The update handler writes all three: a missing `enabled` disables the snippet. */
const SNIPPET_KEYS = ["title", "content", "enabled"] as const;

const PREVIEW_LENGTH = 160;

const snippetId = z.number().int().positive().describe("Snippet id.");
const suggestionId = z.number().int().positive().describe("FAQ suggestion id.");

const snippetTitle = z
  .string()
  .describe(
    'The customer question or topic, for example "How do I get a refund?".',
  );
const snippetContent = z
  .string()
  .describe(
    'Plain text answer, quoted by assistants: self-contained, one topic, full sentences with the details a customer needs (steps, limits, prices, links).',
  );
const snippetEnabled = z
  .boolean()
  .describe("Let AI assistants answer from the snippet.");

const faqStatus = z
  .enum(["pending", "approved", "rejected"])
  .describe('Only this status; omit for all.');

function asRecords(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => key in source).map((key) => [key, source[key]]));
}

function presentSnippet(snippet: Record<string, unknown>): Record<string, unknown> {
  const content = typeof snippet.content === "string" ? snippet.content : "";
  return {
    ...pick(snippet, ["id", "title", "enabled", "source", "source_url", "updated_at"]),
    preview: content.slice(0, PREVIEW_LENGTH),
  };
}

/** The short result of a snippet write, without the content just sent; anything but a record passes through. */
function presentSnippetWrite(data: unknown): unknown {
  return isRecord(data) ? pick(data, ["id", "title", "enabled", "updated_at"]) : data;
}

async function findSnippet(id: number, call: <T>(method: "GET", path: string) => Promise<T>): Promise<Record<string, unknown>> {
  const found = requireList(await call("GET", "/api/v1/ai/snippets"), "the snippet list").filter(isRecord).find((s) => s.id === id);
  if (found === undefined) {
    throw new NotFoundError(`Snippet ${id} not found`, { status: 404, hint: "List the snippets with `ldesk knowledge snippet list` (MCP action snippet_list)." });
  }
  return found;
}

const snippetList = defineOperation({
  name: "snippet_list",
  group: "snippet",
  summary: "List the snippets AI assistants search, with a short preview.",
  method: "GET",
  path: "/api/v1/ai/snippets",
  input: {
    enabled: z.boolean().optional().describe("Filter by enabled state."),
    search: z.string().optional().describe("Only snippets whose title or content contains this text."),
  },
  impact: "read",
  permission: PERMISSION,
  undocumented: true,
  run: async (input, ctx) => {
    const needle = input.search?.toLowerCase();
    return asRecords(await ctx.call("GET", "/api/v1/ai/snippets")).filter((s) => {
      if (input.enabled !== undefined && s.enabled !== input.enabled) return false;
      if (needle === undefined) return true;
      return `${String(s.title ?? "")}\n${String(s.content ?? "")}`.toLowerCase().includes(needle);
    });
  },
  present: (data) => asRecords(data).map(presentSnippet),
  cli: {
    notes: [
      "Prints id, title, enabled, source, source_url, updated_at and a preview of the content; the table shows the first six, --json all of them.",
      "Lists every snippet in one call, with no paging. Without --enabled or --no-enabled it lists both enabled and disabled ones.",
      "Read the full content with `ldesk knowledge snippet get <id>`.",
    ],
    examples: ["ldesk knowledge snippet list", "ldesk knowledge snippet list --json", "ldesk knowledge snippet list --search refund --no-enabled"],
    flags: { enabled: { on: "Only enabled snippets.", off: "Only disabled snippets." } },
  },
});

const snippetGet = defineOperation({
  name: "snippet_get",
  group: "snippet",
  summary: "Get one snippet with its full content.",
  method: "GET",
  path: "/api/v1/ai/snippets",
  input: { id: snippetId },
  positional: ["id"],
  impact: "read",
  permission: PERMISSION,
  undocumented: true,
  run: (input, ctx) => findSnippet(input.id, ctx.call),
  cli: {
    notes: ["Snippet ids come from `ldesk knowledge snippet list`."],
    examples: ["ldesk knowledge snippet get 3", "ldesk knowledge snippet get 3 --json"],
  },
});

const snippetCreate = defineOperation({
  name: "snippet_create",
  group: "snippet",
  summary: "Add a snippet: a self-contained answer with a clear title.",
  method: "POST",
  path: "/api/v1/ai/snippets",
  input: { title: snippetTitle, content: snippetContent, enabled: snippetEnabled.default(true) },
  impact: "write",
  permission: PERMISSION,
  undocumented: true,
  present: presentSnippetWrite,
  cli: {
    notes: ["Read long content from a file with --content @file.txt."],
    examples: [
      'ldesk knowledge snippet create --title "How do I get a refund?" --content @refund-answer.txt',
      'ldesk knowledge snippet create --title "Shipping times" --content "Orders ship within 2 working days." --no-enabled',
    ],
  },
});

const snippetUpdate = defineOperation({
  name: "snippet_update",
  group: "snippet",
  summary: "Change only the given fields of a snippet.",
  method: "PUT",
  path: "/api/v1/ai/snippets/{id}",
  input: { id: snippetId, title: snippetTitle.optional(), content: snippetContent.optional(), enabled: snippetEnabled.optional() },
  positional: ["id"],
  impact: "write",
  permission: PERMISSION,
  undocumented: true,
  run: async (input, ctx) => {
    const current = await findSnippet(input.id, ctx.call);
    const body = mergeForUpdate(current, input, SNIPPET_KEYS);
    return ctx.call("PUT", `/api/v1/ai/snippets/${input.id}`, { body });
  },
  present: presentSnippetWrite,
  cli: {
    notes: ["Only the given fields change; the others keep their value."],
    examples: ["ldesk knowledge snippet update 3 --no-enabled", "ldesk knowledge snippet update 3 --content @refund-answer.txt"],
  },
});

const snippetImportUrl = defineOperation({
  name: "snippet_import_url",
  group: "snippet",
  summary: "Import a web page's readable text as a snippet.",
  method: "POST",
  path: "/api/v1/ai/snippets/import-url",
  input: {
    url: z.string().describe('Page URL; the LibreDesk server fetches it.'),
  },
  impact: "write",
  permission: PERMISSION,
  undocumented: true,
  cli: {
    notes: [
      "The LibreDesk server fetches the page (HTML only) and saves its readable text as an enabled snippet, titled with the page title, or host and path when there is none.",
      "Disable it afterwards with `ldesk knowledge snippet update <id> --no-enabled`.",
    ],
    examples: ["ldesk knowledge snippet import-url --url https://example.com/faq"],
  },
});

const snippetDelete = defineOperation({
  name: "snippet_delete",
  group: "snippet",
  summary: "Delete a snippet.",
  method: "DELETE",
  path: "/api/v1/ai/snippets/{id}",
  input: { id: snippetId },
  positional: ["id"],
  impact: "destructive",
  effect: "Assistants stop using it.",
  permission: PERMISSION,
  undocumented: true,
  cli: {
    notes: ["To keep the snippet but stop assistants using it, run `ldesk knowledge snippet update <id> --no-enabled` instead."],
    examples: ["ldesk knowledge snippet delete 3 --yes"],
  },
});

const faqList = defineOperation({
  name: "faq_list",
  group: "faq",
  summary: "List FAQ suggestions mined from resolved conversations.",
  method: "GET",
  path: "/api/v1/ai/faq-suggestions",
  input: { status: faqStatus.optional() },
  query: ["status"],
  impact: "read",
  permission: PERMISSION,
  undocumented: true,
  cli: {
    notes: ["Approve or reject a suggestion by its id with `ldesk knowledge faq approve` or `reject`."],
    examples: ["ldesk knowledge faq list --status pending", "ldesk knowledge faq list --json"],
  },
});

const faqApprove = defineOperation({
  name: "faq_approve",
  group: "faq",
  summary: "Approve a FAQ suggestion as an enabled snippet, optionally edited.",
  method: "POST",
  path: "/api/v1/ai/faq-suggestions/{id}/approve",
  input: {
    id: suggestionId,
    question: z.string().optional().describe("Replaces the suggested question."),
    answer: z.string().optional().describe("Replaces the suggested answer; keep it self-contained."),
  },
  positional: ["id"],
  impact: "write",
  permission: PERMISSION,
  undocumented: true,
  run: async (input, ctx) => {
    let { question, answer } = input;
    if (question === undefined || answer === undefined) {
      const suggestion = asRecords(await ctx.call("GET", "/api/v1/ai/faq-suggestions")).find((s) => s.id === input.id);
      if (suggestion === undefined) {
        throw new NotFoundError(`FAQ suggestion ${input.id} not found`, { status: 404, hint: "List the suggestions with `ldesk knowledge faq list` (MCP action faq_list)." });
      }
      question ??= String(suggestion.question ?? "");
      answer ??= String(suggestion.answer ?? "");
    }
    return ctx.call("POST", `/api/v1/ai/faq-suggestions/${input.id}/approve`, { body: { question, answer } });
  },
  cli: {
    notes: ["Creates an enabled snippet. Without --question or --answer the suggested text is kept."],
    examples: ["ldesk knowledge faq approve 11", 'ldesk knowledge faq approve 11 --answer "We refund within 30 days."'],
  },
});

const faqReject = defineOperation({
  name: "faq_reject",
  group: "faq",
  summary: "Reject a FAQ suggestion without creating a snippet.",
  method: "POST",
  path: "/api/v1/ai/faq-suggestions/{id}/reject",
  input: { id: suggestionId },
  positional: ["id"],
  impact: "write",
  permission: PERMISSION,
  undocumented: true,
  cli: { examples: ["ldesk knowledge faq reject 11"] },
});

const learningGet = defineOperation({
  name: "learning_get",
  group: "learning",
  summary: "Show whether FAQ learning is on.",
  method: "GET",
  path: "/api/v1/ai/faq-learning",
  input: {},
  impact: "read",
  permission: PERMISSION,
  undocumented: true,
  cli: { examples: ["ldesk knowledge learning get"] },
});

const learningSet = defineOperation({
  name: "learning_set",
  group: "learning",
  summary: "Switch FAQ learning on or off.",
  method: "PUT",
  path: "/api/v1/ai/faq-learning",
  input: { enabled: z.boolean().describe("true turns FAQ learning on, false off.") },
  impact: "write",
  escalate: {
    when: (values) => values.enabled === true,
    condition: "enabled is true",
    impact: "caution",
    effect: "Mines resolved conversations with your AI provider, at a cost per conversation.",
  },
  // Turning learning on costs money, so over MCP the whole switch sits with the other gated actions.
  mcpTool: "publish",
  permission: PERMISSION,
  undocumented: true,
  cli: {
    examples: ["ldesk knowledge learning set --enabled --yes", "ldesk knowledge learning set --no-enabled --yes"],
    flags: { enabled: { on: "Turn FAQ learning on.", off: "Turn FAQ learning off." } },
  },
});

/** AI snippets, FAQ suggestions and FAQ learning: one CLI command, one MCP tool. */
export const aiKnowledgeDomain = defineDomain({
  name: "knowledge",
  tool: "libredesk_ai_knowledge",
  actionPrefix: "knowledge",
  toolset: "knowledge",
  summary: "Manage the snippets AI assistants answer from, and review FAQ suggestions.",
  groups: {
    snippet: "Manage snippets, the short answers AI assistants quote to customers.",
    faq: "Review FAQ suggestions mined from resolved conversations: approve one as a snippet or reject it.",
    learning: "Show or switch FAQ learning, which turns resolved conversations into FAQ suggestions.",
  },
  operations: [
    snippetList,
    snippetGet,
    snippetCreate,
    snippetUpdate,
    snippetImportUrl,
    snippetDelete,
    faqList,
    faqApprove,
    faqReject,
    learningGet,
    learningSet,
  ],
});
