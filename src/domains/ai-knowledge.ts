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
import { mergeForUpdate } from "../ops/merge.js";

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

async function findSnippet(id: number, call: <T>(method: "GET", path: string) => Promise<T>): Promise<Record<string, unknown>> {
  const found = asRecords(await call("GET", "/api/v1/ai/snippets")).find((s) => s.id === id);
  if (found === undefined) {
    throw new NotFoundError(`Snippet ${id} not found`, { status: 404, hint: "List the snippets with snippet_list." });
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
        throw new NotFoundError(`FAQ suggestion ${input.id} not found`, { status: 404, hint: "List the suggestions with faq_list." });
      }
      question ??= String(suggestion.question ?? "");
      answer ??= String(suggestion.answer ?? "");
    }
    return ctx.call("POST", `/api/v1/ai/faq-suggestions/${input.id}/approve`, { body: { question, answer } });
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
});

const learningSet = defineOperation({
  name: "learning_set",
  group: "learning",
  summary: "Switch FAQ learning on or off.",
  method: "PUT",
  path: "/api/v1/ai/faq-learning",
  input: { enabled: z.boolean().describe("true turns FAQ learning on, false off.") },
  impact: "caution",
  effect: "Mines resolved conversations with your AI provider, at a cost per conversation.",
  permission: PERMISSION,
  undocumented: true,
});

/** AI snippets, FAQ suggestions and FAQ learning: one CLI command, one MCP tool. */
export const aiKnowledgeDomain = defineDomain({
  name: "knowledge",
  tool: "libredesk_ai_knowledge",
  toolset: "knowledge",
  summary: "Manage the snippets AI assistants answer from, and review FAQ suggestions.",
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
