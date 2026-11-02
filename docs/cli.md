# CLI reference

`ldesk` manages help centers, articles and AI knowledge from the terminal. Run `ldesk <command> --help` for the flags and examples of one operation.

## Logging in

```bash
ldesk login --url https://helpdesk.example.com --api-key <key>
ldesk status
```

`ldesk login` verifies the credentials against `/api/v1/agents/me` and saves them as a profile. It asks for any missing value in a terminal, the secret without echo, and fails naming them without one. For CI or other non-interactive runs pass `--api-secret <secret>` too, but it lands in your shell history and in the process list; prefer the `LIBREDESK_URL`, `LIBREDESK_API_KEY` and `LIBREDESK_API_SECRET` environment variables there.

The profile name defaults to the host name with dots replaced by dashes (`helpdesk-example-com`); `--name` overrides it. The config lives in `~/.libredesk-mcp/config.json` with mode 0600. Output masks the API secret everywhere.

A base URL may have a trailing slash or a path prefix behind a reverse proxy, such as `https://example.com/helpdesk/`.

## Checking the setup

```bash
ldesk doctor
ldesk doctor --json --timeout 60
```

`ldesk doctor` prints one line per check, each ok, warn or fail: the Node version and the path of the running `ldesk`, the profile in effect and whether its server answers (as `ldesk status`), and the LibreDesk entries in `~/.claude.json` (user scope and the local scope of the current folder) and `./.mcp.json`. It starts every entry exactly as configured, sends the MCP `initialize` request and shows the answer, or the exit code and the last lines the server printed. Run it in the folder where the MCP client runs, because local and project entries depend on it. When an entry fails but `node` with the running `ldesk` works, it prints the `claude mcp add` line that uses that. Env values from the config are never printed, only their names. Each launch may take 10 seconds; `--timeout` changes that, which helps with `npx` on its first run. On Windows a command without an extension, such as `ldesk` or `npx`, is started through `cmd.exe` so that its `.cmd` or `.exe` shim is found on PATH.

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

## Commands

```bash
ldesk help-center list|get|locales|tree|insights|create|update|toggle|delete
ldesk help-center collection list|create|update|publish|toggle|reorder|delete
ldesk articles list|get|create|update|set-status|move|reorder|linkable|link-translation|unlink-translation|delete
ldesk knowledge snippet list|get|create|update|import-url|delete
ldesk knowledge faq list|approve|reject
ldesk knowledge learning get|set
ldesk lookup me|agents|teams|tags|inboxes|statuses|priorities|custom-attributes
ldesk request <method> <path>
ldesk catalog [domain]
```

Running `ldesk` with no arguments in a terminal starts interactive mode (also `ldesk i`): pick a domain, an operation, fill the fields, confirm. It prints the equivalent command at the end. Without a terminal `ldesk` starts the MCP server, the same as `ldesk serve`.

## Conventions

- Flags are the kebab-case field names. Ids that an operation needs go first as arguments, for example `ldesk articles update 12 --title "New title"`, and can also be passed as flags (`--id 12`).
- Boolean flags show the form you pass: `--is-published` where the default is off, `--no-ai-enabled` where it is on, and both on updates.
- `--json` prints the raw result as JSON. The default output is a table for lists and `key: value` lines for single records.
- `--profile <name>` picks a profile for one command.
- Any text or JSON value can be read from a file with `@path`, for example `--content @article.md`. Use `@@` for a value that starts with a literal `@`.
- `null` clears a field that allows it, for example `--parent-id null`.
- A required value you leave out is asked for in a terminal and is an error otherwise.
- Operations that publish, take something offline, cost money or delete data ask for confirmation first, and their `--help` says "Asks for confirmation" and when. Without a terminal they fail and name `--yes`, which confirms without asking. `--yes` is listed only on those commands; the others accept it and ignore it.
- Exit codes: 0 success, 1 error, 130 cancelled. `ldesk status` exits 1 when no profile is set up or the server does not answer. `ldesk doctor` exits 1 when any check fails.

## Help center and collections

```bash
ldesk help-center create --name "Docs" --slug docs --page-title "Help"
ldesk help-center collection create 1 --name "Getting started" --is-published --yes
ldesk help-center collection update 1 5 --parent-id null
ldesk help-center tree 1
ldesk help-center collection publish 1 '[5,6,7]' --is-published --yes
ldesk help-center toggle 1 --yes
```

Creating or updating a collection with `--is-published` or `--no-is-published` asks for confirmation, like `publish` and `toggle`, because it changes what the public help center shows. `collection publish` sets a known state for one collection or a JSON list of ids; `collection toggle` flips it. An article reaches AI assistants only when every collection above it is published.

## Articles

Article content is markdown. Pass it inline or read it from a file:

```bash
ldesk articles create 3 --title "Reset your password" --content @article.md
ldesk articles update 12 --title "How to reset your password"
ldesk articles set-status 12 --status published --yes
ldesk articles set-status '[12,13,14]' --status published --yes
ldesk articles get 12
```

`ldesk articles create <collection-id>` makes a draft with `ai_enabled` on. Publish it with `set-status`, or pass `--status published` to `create`; both ask for confirmation, because a published article is public and used by AI assistants. `set-status` takes one id or a JSON list of ids, and with a list prints ok, failed and an entry per id. Writes print a short record (id, title, slug, status, `ai_enabled`); `get` prints the whole article.

LibreDesk makes the slug from the title when the article is created and keeps it when the title changes later. It drops accents, so a German "ä" becomes "a", not "ae".

LibreDesk stores article bodies as HTML, so `ldesk` converts markdown to HTML on write and back to markdown on read. For what markdown cannot express, such as tables, pass `--format html`: `create` and `update` then send the content as is, and `get --format html` returns the stored HTML. When `get` finds markup that would not survive the trip back to markdown, it returns the HTML and reports `content_format` as `html`. A literal `~` reads back as `&#126;`; `~~text~~` is strikethrough.

Updates only need the id and the fields that change. LibreDesk replaces the whole record on every update, so `ldesk` reads the current record first and sends every field back with your changes applied. A title change does not reset `ai_enabled`, `status`, `content`, `excerpt` or the collection.

## Snippets and FAQ suggestions

Snippets are the plain-text answers AI assistants search. Write each one as a self-contained answer with a clear title.

```bash
ldesk knowledge snippet create --title "Refunds" --content @refunds.txt
ldesk knowledge snippet import-url --url https://example.com/refund-policy
ldesk knowledge snippet update 3 --no-enabled
ldesk knowledge faq list --status pending
ldesk knowledge faq approve 4 --answer "Refunds are paid within 14 days of the request."
ldesk knowledge faq reject 5
ldesk knowledge learning set --enabled --yes
```

Approving an FAQ suggestion turns it into a snippet. `learning set --enabled` lets LibreDesk mine resolved conversations for suggestions, which costs AI provider calls, so it asks for confirmation; turning it off does not.

## Lookups

```bash
ldesk lookup teams
ldesk lookup agents --json
```

Lookups list the ids other commands need: agents, teams, tags, inboxes, statuses, priorities and custom attributes. `ldesk lookup me` shows the agent behind the current API key.

## Raw requests

`ldesk request` reaches any endpoint under `/api/v1/` and `/health` and prints the unwrapped response:

```bash
ldesk request GET /api/v1/agents/compact
ldesk request GET /api/v1/ai/snippets --json
ldesk request PUT /api/v1/ai/faq-learning --body '{"enabled":true}'
```

`--query key=value` adds a query parameter (repeatable) and `--body @file.json` reads the body from a file. `DELETE` asks for confirmation, or needs `--yes` without a terminal.

In Git Bash, MSYS rewrites a leading slash into a Windows path. Set `MSYS_NO_PATHCONV=1` for the command, or leave the leading slash off: `ldesk request GET api/v1/agents/compact`.

`ldesk catalog` lists every operation with its method, path and impact. Add `--json` for the full entries with their fields.
