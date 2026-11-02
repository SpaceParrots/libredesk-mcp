# LibreDesk CLI and MCP server: design

Date: 2026-11-02. Status: draft, waiting for Kevin's approval.

## Intent

A single npm package, published under the SpaceParrots scope, that is both a command line tool and an MCP server for a self-hosted LibreDesk instance. It is modelled on `@spaceparrots/vex` (`D:\Tools\vex`), which does the same for the Vendure Admin API.

The main job is to set up and maintain everything that makes LibreDesk's AI features work well, from the terminal or from Claude: the help center (the knowledge base customers read and the AI searches), AI snippets, FAQ suggestions, AI assistants and their tools, the AI provider config, editor prompts, macros, and the automation rules that route conversations to assistants. The documented REST API is covered as the base, so the tool is also usable for day-to-day work around that setup.

The MCP server should stay slim. Every tool definition costs context in every session, so the tool count stays low and the rest is reachable through one generic request tool.

## Target LibreDesk version

* LibreDesk server v2.9.2 (released 2026-10-31).
* Documented API: `https://docs.libredesk.io/api-reference/openapi.json`, `info.version` 1.0.0, 81 operations, fetched 2026-11-02.
* Undocumented endpoints are taken from the v2.9.2 server source: routes in `cmd/handlers.go`, request and response shapes in `cmd/*.go` and `internal/*/models`. The builder clones `github.com/abhinavxd/libredesk` at tag `v2.9.2` into a reference folder outside this repo and reads shapes from there.

The version lives in one constant (`LIBREDESK_TARGET_VERSION` in `src/constants.ts`) and in the README. Every operation built from source rather than docs is marked `undocumented: true` in its definition, and the README lists them, so it is clear which parts may break on a LibreDesk upgrade.

## Goals

* Full management of the help center: help centers (including theme, locales, custom domain, toggle), collections (nesting, sort order, publish toggle), articles (create, update, move, publish status, sort order, delete, AI-enabled flag, translations via link/unlink, linkable articles), the tree view, and insights (search term stats).
* Full management of AI knowledge: snippets (CRUD, import from URL), FAQ suggestions (list, approve, reject), and the "learn from resolved conversations" setting.
* Full management of the AI setup: completion and embedding provider config (get, update, test), assistants (CRUD, preview/test reply, stats), AI tools (CRUD), editor prompts (CRUD).
* Macros (CRUD, search, apply to conversation) and automation rules (CRUD, toggle, weights, execution mode).
* All 81 documented operations available in the CLI.
* Authentication either through environment variables in the MCP config, or through a one-time `login` in the CLI that the MCP server then reuses.
* An interactive mode (`@clack/prompts`) that walks through any operation by asking for its fields, and `commander` subcommands with flags for scripting.
* An architecture where adding an endpoint means writing one operation definition, not touching four files.

## Non-goals

* Widget API, websockets, WhatsApp webhooks and templates, OAuth/OIDC/SSO setup, password reset, push subscriptions, user notifications, drafts.
* Inbox creation and editing (involves mail and OAuth credentials).
* SLA, business hours, webhooks, context links, roles, email templates, general settings as typed operations. They stay reachable through the generic request command and tool.
* A folder sync for articles (`push` a directory of markdown files). Worth considering later, not in v1.
* Any session/cookie login. API key and secret only.

## Anti-goals (would make this a failure even if it works)

* An MCP server that loads 30+ tools or a large schema into every session.
* Destructive actions without friction: a CLI delete runs without confirmation, or an MCP tool hides that an action deletes something.
* Secrets in output: the API secret, AI provider API keys, or AI tool header values printed by `status`, logs, or tool results.
* Docs and code drifting silently: an undocumented endpoint used without being marked as such.

## Constraints

* TypeScript, ESM, Node `>=22.12.0` (vex allows Node 20, which reached end of life in April 2026).
* Dependencies requested by Kevin: `commander` for commands, `@clack/prompts` for interactive flows. Also `@modelcontextprotocol/sdk` and `zod` as in vex.
* MIT licence, release-please and GitHub Actions CI as in vex, published to npm under `@spaceparrots`.
* Cross-platform: Windows, macOS, Linux. No shell-specific scripts in the repo.
* Conventions copied from vex: kebab-case file names (eslint `unicorn/filename-case`), JSDoc with `@module` on every file, `readonly` service inputs, typed errors with a `hint`, vitest with coverage thresholds.

## Decisions Kevin made

* Base: documented API plus the undocumented parts needed for the AI features (help center, snippets, macros, automations and related AI setup), with the target version noted.
* Help center and AI snippets are the top priority.
* `commander` and `@clack/prompts`.
* MCP auth via env vars in the MCP config, or via a one-time CLI login.
* Slim MCP tool surface.
* Test against a local LibreDesk in Docker Compose first. The production instance is used only in the worst case.

## Design (my calls, open to change)

### Package and binary

Package `@spaceparrots/libredesk-mcp` (matches the folder), one binary `ldesk`. With a single binary, `npx -y @spaceparrots/libredesk-mcp serve` works without naming it.

### Entry point

* `ldesk serve` starts the MCP server over stdio.
* `ldesk` with no arguments starts the interactive menu when stdin is a TTY, and the MCP server when it is not (an MCP client spawns it with piped stdio). `mcp install` always writes `serve` explicitly, so the fallback is only a convenience.
* Any other arguments go to commander.

### Authentication and profiles

LibreDesk authenticates with an agent's API key and secret, sent as `Authorization: token <key>:<secret>`. API keys pass the same `perm()` middleware as sessions, so undocumented admin routes work with them too (checked in `cmd/middlewares.go`).

* `ldesk login` asks for base URL, API key and secret, calls `GET /api/v1/agents/me` to verify, and saves a named profile (default name from the host). The first profile becomes active.
* Profiles are stored in `~/.libredesk-mcp/config.json`, written with mode 0600. Same structure as vex: named profiles, an active profile, and a `projects` map from directory to profile (`ldesk profile link`).
* Environment variables `LIBREDESK_URL`, `LIBREDESK_API_KEY`, `LIBREDESK_API_SECRET` form an implicit profile. `LIBREDESK_PROFILE` picks a stored profile.
* Resolution order, highest first: `--profile` flag or `profile` tool param, then the three env vars when all are set, then `LIBREDESK_PROFILE`, then a project link matching the cwd, then the active profile. If only some of the three env vars are set, fail with a message naming the missing ones.
* `ldesk profile list|use|remove|link|unlink`, `ldesk status` (profile in use, where it came from, server reachable, agent name, secret masked).
* `ldesk mcp install` writes the server entry into `.mcp.json` (project) or prints the snippet for Claude Desktop and other clients. It asks whether to rely on the stored login (`LIBREDESK_PROFILE=<name>`) or embed the three env vars. Reuse vex's merge logic from `src/services/mcp-config.ts`.

### Operation definitions: one source for CLI, MCP and interactive mode

This is where the design deliberately differs from vex. In vex, a new operation means a service function, a command, a tool action and two registrations. Here every operation is declared once:

```ts
export const createArticle = defineOperation({
  name: "create",                 // action / subcommand name
  summary: "Create an article in a collection",
  method: "POST",
  path: "/api/v1/collections/{collection_id}/articles",
  input: z.object({ collection_id: z.number().describe("…"), title: z.string().describe("…"), /* … */ }),
  undocumented: true,
  destructive: false,
  transform: articleContentToHtml,  // optional: reshape input before sending
  present: summarizeArticle,        // optional: shape output for MCP and tables
});
```

Operations are grouped in domains, one folder each:

```
src/domains/help-center/   help centers, collections, tree, insights
src/domains/articles/
src/domains/ai-knowledge/  snippets, FAQ suggestions, learning setting
src/domains/ai-assistants/ assistants, AI tools
src/domains/ai-settings/   provider config, editor prompts
src/domains/macros/
src/domains/automations/
src/domains/conversations/ documented conversation, message and search endpoints
src/domains/contacts/      contacts and contact notes
src/domains/workspace/     agents, teams, tags, statuses, priorities, inboxes, custom attributes
src/domains/reports/
src/domains/media/
src/domains/index.ts       the list of domains, the only registration point
```

Three generators read the same definitions:

* **CLI**: `ldesk <domain> <operation>` with flags derived from the zod shape (`collection_id` becomes `--collection-id`, booleans become `--flag/--no-flag`, objects and arrays take JSON or `@file.json`). An operation can name positional arguments (`ldesk articles get 42`). Missing required fields are prompted for when stdin is a TTY, otherwise the command fails listing them. Output is a table or pretty view by default, `--json` for raw.
* **MCP**: one action-dispatch tool per MCP tool group (below), built like vex's `actionTool`: a flat merged schema with an `action` enum, per-action validation at call time.
* **Interactive**: `ldesk` (or `ldesk i`) shows domain, then operation, then asks for each field with clack, using the zod descriptions and enum values, and shows the equivalent command line at the end so it can be reused in scripts.

A typed service layer still exists for the cases the generic path cannot express (multipart media upload, markdown conversion, lookups that chain two calls). Operations call into it through `transform` or a custom `run` function. An operation without either is a plain HTTP call.

### HTTP client

Native `fetch`, no HTTP library. One `request(profile, method, path, {query, body})` that fills path params, sets auth and JSON headers, unwraps LibreDesk's `{ "data": … }` envelope, and maps failures to typed errors: 401 (bad key, hint to run `ldesk login`), 403 (names the missing permission where the route table knows it, for example `help_center:manage`), 404, 409/422 with the server's message, network errors with the URL.

### MCP tool surface

Ten tools by default, each an action-dispatch tool:

| Tool | Covers |
| - | - |
| `libredesk_help_center` | help centers, collections, tree, locales, insights |
| `libredesk_articles` | articles, status, move, sort, translations |
| `libredesk_ai_knowledge` | snippets, URL import, FAQ suggestions, learning setting |
| `libredesk_ai_assistants` | assistants (incl. preview and stats), AI tools |
| `libredesk_ai_settings` | provider config and test, editor prompts |
| `libredesk_macros` | macros |
| `libredesk_automations` | automation rules |
| `libredesk_lookup` | read-only lists the others need IDs from: teams, tags, inboxes, statuses, priorities, agents, custom attributes |
| `libredesk_request` | any method and path, for everything not typed above (conversations, contacts, reports, settings) |
| `libredesk_status` | profile in use, server reachable, agent, target version |

* `LIBREDESK_TOOLSETS` limits the tools further, for example `knowledge` (help center, articles, AI knowledge) or `knowledge,ai`. `lookup`, `request` and `status` are always on.
* A vitest token-budget test (like vex's `tests/tools/token-budget.test.ts`) fails when the serialized tool definitions grow past a set limit. Starting limit: measure the first full build and set the budget about 10% above it.
* Confirmation and annotations follow the impact levels below.
* List actions return summaries (ID, title, status, locale, updated) and leave out article and snippet bodies. `get` returns the full record.
* Server instructions (sent on MCP `initialize`) explain the knowledge model in a few lines: what snippets and articles are for, that articles need `ai_enabled` and published status to reach assistants, that a conversation only gets AI replies when assigned to an assistant (via an automation rule), and to use `libredesk_lookup` for IDs.

### Content format for articles and snippets

LibreDesk stores article content as HTML. Agents and people write markdown more naturally.

* Article create/update accept `content` plus `format: "markdown" | "html"`, default `markdown`, converted with `marked`.
* Article get accepts `format: "markdown" | "html"`, default `markdown`, converted back with `turndown`. That way an agent can read, edit and write back in markdown.
* In the CLI, any string or JSON flag value starting with `@` is read from a file, so `--content @article.md` works (`@@` for a literal `@`).
* Snippets are plain text in LibreDesk (the admin form is a textarea), so they get no conversion.
* LibreDesk's PUT endpoints replace the whole record. Every `update` operation reads the current record, merges the changed fields and sends the full object, so a partial update never resets `ai_enabled` or other fields.

### Impact levels and confirmation

Each operation has an `impact`: `read`, `write`, `caution` or `destructive`.

* `caution` covers writes that cost money or reach customers: changing the embedding provider (re-embeds every snippet, article and tag), toggling a help center or collection, creating or toggling an automation rule, enabling an assistant, and calls that hit the paid provider (assistant preview, provider test).
* In the CLI, `caution` and `destructive` operations print one line saying what will happen and ask for confirmation. `--yes` skips the prompt, and a non-TTY run without `--yes` fails.
* In MCP, the action summary names the effect ("re-embeds all knowledge at provider cost") and the tool gets `destructiveHint` when any of its actions is `destructive`. MCP does not block these actions, since the client already asks the user before running a tool.
* `libredesk_request` refuses `DELETE` unless `confirm: true` is passed.

### Secrets in output

* One shared output layer masks values by key name before anything is printed or returned to MCP: `api_key`, `api_secret`, `secret`, `password`, `token`, and every value inside an AI tool's `headers`. This covers `libredesk_request` and `--json` too.
* `ldesk workspace agents generate-api-key` is the one exception. It prints the new secret once, in the CLI, with a note that it cannot be shown again. This operation is not exposed over MCP.

### Markdown round trip

Converting HTML to markdown can lose content: tables with merged cells, embeds, and attributes on images. An agent that reads, edits and writes back would silently remove it.

* On `get` with `format: "markdown"`, the HTML is checked against an allow-list of elements and attributes that markdown can represent. If anything else is present (tables, embeds, styles, classes), the result is HTML with a `content_format: "html"` field and a note naming the element, so the agent edits HTML for that article. A round-trip comparison was considered and dropped: the LibreDesk editor and `marked` format HTML differently, so it would flag almost every article.
* Tests cover a set of real LibreDesk article bodies, both lossless and lossy.

### Domains not in the default MCP tools

Phase 3 domains (conversations, contacts, workspace writes, reports) get MCP tools too, in an opt-in toolset `support` that is off by default. For everything not loaded, `libredesk_request` has a `catalog` action that lists the available operations with method, path and fields, filtered by domain. The agent can then call `request` with the right path and body without the schemas sitting in context every session.

### Phases

1. Foundation and knowledge: project scaffold (copy vex's tooling), local LibreDesk in Docker Compose, config and profiles, login, status, HTTP client, errors, operation definitions and the three generators, `help-center`, `articles`, `ai-knowledge`, MCP server with those tools plus `lookup`, `request`, `status`, `mcp install`.
2. AI setup and workflow: `ai-assistants`, `ai-settings`, `macros`, `automations`, `media` upload.
3. Remaining documented API: `conversations`, `contacts`, `workspace` (writes too), `reports`.

Each phase ends usable and publishable.

### Testing

* Unit tests for the generators (flag derivation, prompt derivation, action merging), the HTTP client (envelope, error mapping), profile resolution order, markdown conversion, mcp-config merging.
* Per operation: a table-driven test that its input produces the expected method, path and body against a mocked `fetch`.
* Token-budget test for the MCP surface.
* A local LibreDesk for development: `docker-compose.dev.yml` in the repo runs LibreDesk v2.9.2 with Postgres and Redis, plus a short README section on creating the admin user and API key. Every operation is checked against it while building. This is the primary test server.
* An optional live test suite, enabled only when `LIBREDESK_URL` and credentials are set. Against the local instance it covers everything, creating and deleting what it needs.
* Kevin has a production instance and no separate test instance. Production is a last resort, used only when the local instance can't answer a question, and then only for read operations plus create-then-delete of a draft article in a throwaway collection. The live suite gets a `LIBREDESK_LIVE_SCOPE=readonly` switch for that case.

## Left to the builder

* Exact zod shapes per operation, read from the v2.9.2 handlers and models. Field names follow LibreDesk's JSON (snake_case).
* Whether `/api/v1/config` or `/health` exposes a server version; if one does, `status` warns when it differs from the target version.
* Table layouts and how much of each record the `present` functions keep.
* README structure, following vex's.
