# libredesk-mcp

CLI tool (`ldesk`) and MCP server for the [LibreDesk](https://libredesk.io) helpdesk API. Use `ldesk` from your terminal to manage help centers, knowledge base articles and the knowledge your AI assistants answer from, or connect it as an MCP server so Claude can do it for you.

Phase 1 covers the knowledge side: help centers and collections, articles (written and read as markdown), AI snippets, FAQ suggestions, read-only lookups of agents, teams, inboxes and other settings, and a raw request escape hatch for every other endpoint.

## Requirements

- Node.js 22.12 or newer.
- A LibreDesk instance. The target version is **2.9.2**. Other versions may work, but endpoint shapes are only checked against 2.9.2.
- An API key and secret of an agent. The agent's role decides what the tools may do, for example `help_center:manage` for help centers and articles.

## Installation

```bash
npm install -g @spaceparrots/libredesk-mcp
```

This puts the `ldesk` command on your PATH. To try it without installing, use `npx -y @spaceparrots/libredesk-mcp <command>`.

## Quick start

```bash
# Verify the credentials and save them as a profile
ldesk login --url https://helpdesk.example.com --api-key <key> --api-secret <secret>

# Check the profile in effect and whether the server answers
ldesk status

# List the help centers, then the articles of one
ldesk help-center list
ldesk articles list 1
```

`ldesk login` without flags asks for the missing values in a terminal, and fails naming them without one. The profile name defaults to the host name with dots replaced by dashes (`helpdesk-example-com`); `--name` overrides it. The config lives in `~/.libredesk-mcp/config.json` with mode 0600. Output masks the API secret everywhere.

Running `ldesk` with no arguments in a terminal starts interactive mode (also `ldesk i`): pick a domain, an operation, fill the fields, confirm. Without a terminal it starts the MCP server, the same as `ldesk serve`.

## Profiles

A profile is a named URL plus key and secret. The profile for a command is chosen in this order:

1. `--profile <name>` on a command, or the `profile` field of an MCP tool.
2. `LIBREDESK_URL`, `LIBREDESK_API_KEY` and `LIBREDESK_API_SECRET`, when all three are set (a profile named `env`). Setting only some of them is an error that names the missing ones.
3. `LIBREDESK_PROFILE`.
4. A profile linked to the current directory.
5. The active profile.

```bash
ldesk profile list              # * marks the active profile and the one in effect here
ldesk profile use staging       # make a profile the active one
ldesk profile link staging      # use it whenever a command runs inside this directory
ldesk profile unlink
ldesk profile remove staging
```

A base URL may have a trailing slash or a path prefix behind a reverse proxy, such as `https://example.com/helpdesk/`.

## Commands

```bash
ldesk help-center list|get|locales|tree|insights|create|update|toggle|delete
ldesk help-center collection list|create|update|toggle|reorder|delete
ldesk articles list|get|create|update|set-status|move|reorder|linkable|link-translation|unlink-translation|delete
ldesk knowledge snippet list|get|create|update|import-url|delete
ldesk knowledge faq list|approve|reject
ldesk knowledge learning get|set
ldesk lookup me|agents|teams|tags|inboxes|statuses|priorities|custom-attributes
ldesk request <method> <path>
ldesk catalog [domain]
```

Every operation takes `--json` for machine output, `--profile <name>`, and `--yes` to confirm without asking. Run `ldesk <command> --help` for the flags of one operation. Flags are the kebab-case field names. A required value you leave out is asked for in a terminal and is an error otherwise.

Operations that make public changes or delete data ask for confirmation first. Without a terminal they fail and name `--yes` instead of waiting.

### Help center and collections

```bash
ldesk help-center create --name "Docs" --slug docs --page-title "Help"
ldesk help-center collection create 1 --name "Getting started" --is-published
ldesk help-center tree 1
ldesk help-center toggle 1 --yes
```

### Articles from markdown

Article content is markdown. Pass it inline or read it from a file with `@`:

```bash
ldesk articles create 3 --title "Reset your password" --content @article.md
ldesk articles update 12 --title "How to reset your password"
ldesk articles set-status 12 --status published --yes
ldesk articles get 12
```

`ldesk articles create <collection-id>` makes a draft with `ai_enabled` on. Publishing is a separate step through `set-status`.

LibreDesk stores article bodies as HTML, so `ldesk` converts markdown to HTML on write and back to markdown on read. For what markdown cannot express, such as tables, pass `--format html`: `create` and `update` then send the content as is, and `get --format html` returns the stored HTML. When `get` finds markup that would not survive the trip back to markdown, it returns the HTML and reports `content_format` as `html`. The MCP tools use the same `format` field.

Updates only need the id and the fields that change. LibreDesk replaces the whole record on every PUT, so `ldesk` reads the current record first and sends every field back with your changes applied. A title change does not reset `ai_enabled`, `status`, `content`, `excerpt` or the collection.

### Snippets and FAQ suggestions

```bash
ldesk knowledge snippet create --title "Refunds" --content "Refunds are paid within 14 days."
ldesk knowledge snippet import-url --url https://example.com/refund-policy
ldesk knowledge faq list --status pending
ldesk knowledge faq approve 4 --answer "Refunds are paid within 14 days of the request."
ldesk knowledge faq reject 5
ldesk knowledge learning set --enabled
```

### Raw requests

`ldesk request` reaches any endpoint under `/api/v1/` and `/health` and prints the unwrapped response:

```bash
ldesk request GET /api/v1/agents/compact
ldesk request GET /api/v1/ai/snippets --json
ldesk request PUT /api/v1/ai/faq-learning --body '{"enabled":true}'
```

`--query key=value` adds a query parameter (repeatable) and `--body @file.json` reads the body from a file.

In Git Bash, MSYS rewrites a leading slash into a Windows path. Set `MSYS_NO_PATHCONV=1` for the command, or leave the leading slash off: `ldesk request GET api/v1/agents/compact`.

`ldesk catalog` lists every operation with its method, path and impact. Add `--json` for the full entries with their fields.

## MCP server

`ldesk serve` runs the server on stdio. It registers one tool per domain, each with an `action` field:

- `libredesk_help_center`: help centers and collections.
- `libredesk_articles`: articles.
- `libredesk_ai_knowledge`: snippets, FAQ suggestions and the learning setting.
- `libredesk_lookup`: read-only lookups of ids.
- `libredesk_request`: `catalog` finds an endpoint, `call` sends a raw request.
- `libredesk_status`: the profile in use and whether its server answers.

Every tool takes an optional `profile`. Actions that change public pages, delete data or cost money are marked caution or destructive, and the server instructions tell the model to confirm them with you first.

### Setup with a stored login

Run `ldesk login` once, then point the MCP client at that profile with `LIBREDESK_PROFILE`. The secret stays out of the MCP config. Claude Code, `.mcp.json` in the project:

```json
{
  "mcpServers": {
    "libredesk": {
      "command": "ldesk",
      "args": ["serve"],
      "env": { "LIBREDESK_PROFILE": "helpdesk-example-com" }
    }
  }
}
```

Or with the CLI: `claude mcp add libredesk -e LIBREDESK_PROFILE=helpdesk-example-com -- ldesk serve`.

Without `LIBREDESK_PROFILE` the server uses the profile linked to its working directory, else the active one.

### Setup with environment variables

Put the credentials in the config of the MCP client instead. Claude Code, `.mcp.json`:

```json
{
  "mcpServers": {
    "libredesk": {
      "command": "ldesk",
      "args": ["serve"],
      "env": {
        "LIBREDESK_URL": "https://helpdesk.example.com",
        "LIBREDESK_API_KEY": "<your-api-key>",
        "LIBREDESK_API_SECRET": "<your-api-secret>"
      }
    }
  }
}
```

The same with the CLI: `claude mcp add libredesk -e LIBREDESK_URL=https://helpdesk.example.com -e LIBREDESK_API_KEY=<your-api-key> -e LIBREDESK_API_SECRET=<your-api-secret> -- ldesk serve`.

### Claude Desktop

Claude Desktop reads `claude_desktop_config.json` (Settings, Developer, Edit Config). The entry has the same shape. Desktop often does not see your shell PATH, so running through npx or giving the full path to `ldesk` as `command` is safer:

```json
{
  "mcpServers": {
    "libredesk": {
      "command": "npx",
      "args": ["-y", "@spaceparrots/libredesk-mcp", "serve"],
      "env": { "LIBREDESK_PROFILE": "helpdesk-example-com" }
    }
  }
}
```

Use the `LIBREDESK_URL`, `LIBREDESK_API_KEY` and `LIBREDESK_API_SECRET` variables in `env` instead of `LIBREDESK_PROFILE` to skip `ldesk login`.

### `ldesk mcp install`

`ldesk mcp install` writes the entry into `./.mcp.json` for you and keeps the other servers and keys in the file.

```bash
ldesk mcp install                       # pin the active profile with LIBREDESK_PROFILE
ldesk mcp install --mode env --yes      # copy the credentials into the file
ldesk mcp install --npx                 # run through npx instead of a global ldesk
ldesk mcp install --toolsets knowledge  # also set LIBREDESK_TOOLSETS
ldesk mcp install --scope print         # print the snippet for another client
```

`--mode env` writes the API secret into `.mcp.json`, which is often committed, so it asks first and needs `--yes` without a terminal. `--scope print` hides the secret behind the placeholder `<your-api-secret>`. Add `--show-secret` to print the real one.

### Toolsets

`LIBREDESK_TOOLSETS` picks which domain tools are registered, as a comma separated list of:

- `knowledge`: help center, articles and AI knowledge.
- `ai`, `workflow`, `support`: reserved for later phases.
- `all`: every toolset.

Unset, every toolset except `support` is on. The `core` toolset (lookup) is always on, and so are `libredesk_request` and `libredesk_status`. `libredesk_request` can reach every operation, including those of a toolset that is switched off. An unknown name stops the server with a message listing the valid ones.

```json
{ "env": { "LIBREDESK_TOOLSETS": "knowledge" } }
```

## Undocumented operations

LibreDesk publishes an OpenAPI spec, but the help center, article and AI knowledge endpoints are not in it. Their shapes were taken from the LibreDesk 2.9.2 source code. Operations built that way carry an `undocumented` flag, shown as `[undocumented API]` in `--help` and in the catalog. They can change between LibreDesk releases without notice, so check them after an upgrade.

Of 45 operations, 39 are undocumented. Only `lookup me`, `tags`, `inboxes`, `statuses`, `priorities` and `custom-attributes` come from the documented spec:

- `libredesk_help_center`: `list`, `get`, `locales`, `tree`, `insights`, `create`, `update`, `toggle`, `delete`, `collection_list`, `collection_create`, `collection_update`, `collection_toggle`, `collection_reorder`, `collection_delete`
- `libredesk_articles`: `list`, `get`, `create`, `update`, `set_status`, `move`, `reorder`, `linkable`, `link_translation`, `unlink_translation`, `delete`
- `libredesk_ai_knowledge`: `snippet_list`, `snippet_get`, `snippet_create`, `snippet_update`, `snippet_import_url`, `snippet_delete`, `faq_list`, `faq_approve`, `faq_reject`, `learning_get`, `learning_set`
- `libredesk_lookup`: `agents`, `teams`

To regenerate the list with methods and paths, build first because the script imports from `dist/`:

```bash
npm run build
npm run docs:undocumented
```

## Development

```bash
npm install
npm run build          # compile to dist/
npm run dev -- status  # run from source with tsx
npm run verify         # lint, typecheck and unit tests
npm run test:coverage  # coverage with 80% thresholds
```

### Local LibreDesk stack and live tests

A compose file starts LibreDesk 2.9.2 with its database on `http://localhost:9000`.

```bash
npm run dev:up         # start the stack
npm run dev:bootstrap  # create the agent ldesk-dev@example.com and an API key, write .env.live
npm run test:live      # run the live tests against it
npm run dev:down       # stop it
```

`dev:bootstrap` prints the three `LIBREDESK_*` lines and writes them to `.env.live`, which git ignores. Load them into the shell, with a throwaway config dir, before running the live tests:

```bash
export LIBREDESK_CONFIG_DIR="$(mktemp -d)"
set -a; eval "$(node dev/bootstrap.mjs 2>/dev/null)"; set +a
npm run test:live
```

The live tests create and delete their own data. To run them against a production instance, set `LIBREDESK_LIVE_SCOPE=readonly` so they create, change and delete nothing.

### Adding an operation

Every endpoint is declared once with `defineOperation` in a file under `src/domains/`. The CLI command, the interactive prompts, the MCP action and the catalog entry are generated from that declaration.

1. Add a `defineOperation({ name, summary, method, path, input, impact, ... })` to the domain file. `input` is a zod shape with a `.describe()` on every field. Set `undocumented: true` when the shape comes from the LibreDesk source.
2. Add it to the `operations` array of the domain.
3. For a new domain, create `src/domains/<name>.ts` that exports a `Domain` and add it to `DOMAINS` in `src/domains/index.ts`.
4. Add a unit test and, when the endpoint exists on 2.9.2, a live test.
5. Run `npm run verify`.

`CLAUDE.md` lists the rules an operation has to follow.

## License

MIT
