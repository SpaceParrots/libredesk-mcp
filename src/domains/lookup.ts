/**
 * @module domains/lookup
 * Read-only lookups for the ids other tools ask for: the current agent, agents, teams, tags,
 * inboxes, statuses, priorities and custom attributes. Output is trimmed to what picks a record:
 * secrets, inbox configs and API key fields never pass through.
 */

import { z } from "zod";
import { defineDomain, defineOperation } from "../ops/define.js";

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => key in source).map((key) => [key, source[key]]));
}

function asRecords(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

function listOf(keys: readonly string[]): (data: unknown) => Record<string, unknown>[] {
  return (data) => asRecords(data).map((item) => pick(item, keys));
}

const me = defineOperation({
  name: "me",
  summary: "Show the agent the API key belongs to: id, name, email, roles and permissions.",
  method: "GET",
  path: "/api/v1/agents/me",
  input: {},
  impact: "read",
  present: (data) => {
    const agent = (data ?? {}) as Record<string, unknown>;
    return {
      ...pick(agent, ["id", "first_name", "last_name", "email", "type", "enabled", "availability_status", "roles", "permissions"]),
      teams: asRecords(agent.teams).map((team) => pick(team, ["id", "name"])),
    };
  },
});

const agents = defineOperation({
  name: "agents",
  summary: "List all agents with id, name and email, for assignment.",
  method: "GET",
  path: "/api/v1/agents/compact",
  input: {},
  impact: "read",
  undocumented: true,
  present: listOf(["id", "first_name", "last_name", "email", "type", "enabled", "availability_status"]),
});

const teams = defineOperation({
  name: "teams",
  summary: "List all teams with id and name, for assignment and fallback.",
  method: "GET",
  path: "/api/v1/teams/compact",
  input: {},
  impact: "read",
  undocumented: true,
  present: listOf(["id", "name", "emoji"]),
});

const tags = defineOperation({
  name: "tags",
  summary: "List all conversation tags.",
  method: "GET",
  path: "/api/v1/tags",
  input: {},
  impact: "read",
  present: listOf(["id", "name"]),
});

const inboxes = defineOperation({
  name: "inboxes",
  summary: "List all inboxes with channel and whether they are enabled.",
  method: "GET",
  path: "/api/v1/inboxes",
  input: {},
  impact: "read",
  present: listOf(["id", "name", "channel", "enabled"]),
});

const statuses = defineOperation({
  name: "statuses",
  summary: "List all conversation statuses.",
  method: "GET",
  path: "/api/v1/statuses",
  input: {},
  impact: "read",
  present: listOf(["id", "name", "category"]),
});

const priorities = defineOperation({
  name: "priorities",
  summary: "List all conversation priorities.",
  method: "GET",
  path: "/api/v1/priorities",
  input: {},
  impact: "read",
  present: listOf(["id", "name"]),
});

const customAttributes = defineOperation({
  name: "custom_attributes",
  summary: "List custom attribute definitions, optionally only those of one entity.",
  method: "GET",
  path: "/api/v1/custom-attributes",
  input: {
    applies_to: z
      .string()
      .optional()
      .describe('Only return attributes that apply to this entity: "contact" or "conversation". Omit for all.'),
  },
  query: ["applies_to"],
  impact: "read",
  present: listOf(["id", "key", "name", "applies_to", "data_type", "values"]),
});

/** Read-only lookups of agents, teams, tags, inboxes, statuses, priorities and custom attributes. */
export const lookupDomain = defineDomain({
  name: "lookup",
  tool: "libredesk_lookup",
  toolset: "core",
  summary: "Look up agents, teams, tags, inboxes, statuses, priorities and custom attributes.",
  operations: [me, agents, teams, tags, inboxes, statuses, priorities, customAttributes],
});
