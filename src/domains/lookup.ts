/**
 * @module domains/lookup
 * Read-only lookups for the ids other tools ask for: the current agent, agents, teams, tags,
 * inboxes, statuses, priorities and custom attributes. Output is trimmed to what picks a record:
 * secrets, inbox configs and API key fields never pass through.
 */

import { z } from "zod";
import { isRecord } from "../guards.js";
import { defineDomain, defineOperation } from "../ops/define.js";
import { requireList, requireRecord } from "../ops/merge.js";

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => key in source).map((key) => [key, source[key]]));
}

function asRecords(data: unknown): Record<string, unknown>[] {
  return requireList(data, "the response").filter(isRecord);
}

function listOf(keys: readonly string[]): (data: unknown) => Record<string, unknown>[] {
  return (data) => asRecords(data).map((item) => pick(item, keys));
}

const me = defineOperation({
  name: "me",
  summary: "The API key's agent, with roles and permissions.",
  method: "GET",
  path: "/api/v1/agents/me",
  input: {},
  impact: "read",
  present: (data) => {
    const agent = requireRecord(data, "the agent");
    return {
      ...pick(agent, ["id", "first_name", "last_name", "email", "type", "enabled", "availability_status", "roles", "permissions"]),
      teams: (Array.isArray(agent.teams) ? agent.teams : []).filter(isRecord).map((team) => pick(team, ["id", "name"])),
    };
  },
  cli: { examples: ["ldesk lookup me", "ldesk lookup me --json"] },
});

const agents = defineOperation({
  name: "agents",
  summary: "List agents (id, name, email).",
  method: "GET",
  path: "/api/v1/agents/compact",
  input: {},
  impact: "read",
  undocumented: true,
  present: listOf(["id", "first_name", "last_name", "email", "type", "enabled", "availability_status"]),
  cli: { examples: ["ldesk lookup agents", "ldesk lookup agents --json"] },
});

const teams = defineOperation({
  name: "teams",
  summary: "List teams (id, name).",
  method: "GET",
  path: "/api/v1/teams/compact",
  input: {},
  impact: "read",
  undocumented: true,
  present: listOf(["id", "name", "emoji"]),
  cli: { examples: ["ldesk lookup teams"] },
});

const tags = defineOperation({
  name: "tags",
  summary: "List conversation tags.",
  method: "GET",
  path: "/api/v1/tags",
  input: {},
  impact: "read",
  present: listOf(["id", "name"]),
  cli: { examples: ["ldesk lookup tags"] },
});

const inboxes = defineOperation({
  name: "inboxes",
  summary: "List inboxes with channel and enabled state.",
  method: "GET",
  path: "/api/v1/inboxes",
  input: {},
  impact: "read",
  present: listOf(["id", "name", "channel", "enabled"]),
  cli: {
    notes: ["An inbox id is what `ldesk help-center update <id> --livechat-inbox-id` takes."],
    examples: ["ldesk lookup inboxes"],
  },
});

const statuses = defineOperation({
  name: "statuses",
  summary: "List conversation statuses.",
  method: "GET",
  path: "/api/v1/statuses",
  input: {},
  impact: "read",
  present: listOf(["id", "name", "category"]),
  cli: { examples: ["ldesk lookup statuses"] },
});

const priorities = defineOperation({
  name: "priorities",
  summary: "List conversation priorities.",
  method: "GET",
  path: "/api/v1/priorities",
  input: {},
  impact: "read",
  present: listOf(["id", "name"]),
  cli: { examples: ["ldesk lookup priorities"] },
});

const customAttributes = defineOperation({
  name: "custom_attributes",
  summary: "List custom attribute definitions.",
  method: "GET",
  path: "/api/v1/custom-attributes",
  input: {
    applies_to: z
      .string()
      .optional()
      .describe('Only attributes of this entity; omit for all.'),
  },
  query: ["applies_to"],
  impact: "read",
  present: listOf(["id", "key", "name", "applies_to", "data_type", "values"]),
  cli: { examples: ["ldesk lookup custom-attributes", "ldesk lookup custom-attributes --applies-to contact --json"] },
});

/** Read-only lookups of agents, teams, tags, inboxes, statuses, priorities and custom attributes. */
export const lookupDomain = defineDomain({
  name: "lookup",
  tool: "libredesk_lookup",
  toolset: "core",
  summary: "Look up ids of agents, teams, inboxes and other settings.",
  operations: [me, agents, teams, tags, inboxes, statuses, priorities, customAttributes],
});
