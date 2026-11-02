/**
 * @module mcp/instructions
 * Server instructions sent in the MCP `initialize` response. Clients put them into the model's
 * system prompt, so they teach how to drive the tools. Kept to at most 25 lines.
 */

/** What the model reads about this server before its first tool call. */
export const SERVER_INSTRUCTIONS = `LibreDesk tools manage a LibreDesk helpdesk: help centers, knowledge base articles and the knowledge AI assistants answer from.

Tools take an "action" plus that action's fields; each tool description lists its actions as name(required fields), with "..." when optional fields exist. Updates only need the id and the fields that change; the rest keeps its value.

Every tool takes an optional "profile" to pick a stored LibreDesk login for that call. libredesk_status shows the profile in use and whether its server answers; call it when a tool reports an auth, profile or connection error.

Knowledge model:
- Snippets (libredesk_ai_knowledge) are plain-text answers shared by all AI assistants.
- An article reaches assistants only when it is published, ai_enabled is on, every collection above it is published and the help center is online. A change is re-indexed within about a minute.
- FAQ suggestions mined from conversations become snippets when approved.
- A conversation gets AI replies only when it is assigned to an assistant, usually by an automation rule.

Write article content as markdown. When get returned content_format "html", edit and resend it as HTML with format "html".

Use libredesk_lookup for ids of agents, teams, inboxes and the like. For anything else, find the endpoint with libredesk_request action catalog, then use action call.

The other tools create and edit drafts. Publishing, help center online state and FAQ learning are in libredesk_publish, deletes in libredesk_delete; both take lists of ids where noted. They change public pages, delete data or cost money: confirm them with the user first. Write actions return a short record; use get for the full one.`;
