# CLI reference

`ldesk` manages help centers, articles and AI knowledge from the terminal. Run `ldesk <command> --help` for the flags and examples of one operation.

## Logging in

```bash
ldesk login --url https://helpdesk.example.com --api-key <key>
ldesk status
```

`ldesk login` checks the credentials against your LibreDesk and saves them as a profile. In a terminal it asks for any value you left out, and the secret is not shown while you type it.

For CI and other runs without a terminal, you can pass `--api-secret <secret>`, but it then ends up in your shell history and the process list. Setting the `LIBREDESK_URL`, `LIBREDESK_API_KEY` and `LIBREDESK_API_SECRET` environment variables is safer there.

- The profile is named after the host, with dots replaced by dashes (`helpdesk-example-com`). `--name` picks another name.
- Profiles are stored in `~/.libredesk-mcp/config.json` with file mode 0600. The API secret is masked in all output.
- The URL may end with a slash or include a path, for a LibreDesk behind a reverse proxy such as `https://example.com/helpdesk/`.

## Checking the setup

```bash
ldesk doctor
ldesk doctor --json --timeout 60
```

`ldesk doctor` checks everything between you and a working MCP connection and prints one line per check, marked ok, warn or fail:

- the Node version and the path of the `ldesk` that is running,
- the profile in effect and whether its server answers, like `ldesk status`,
- every LibreDesk entry in `~/.claude.json` (user scope, and the local scope of the current folder) and in `./.mcp.json`.

It starts each MCP entry exactly as configured, sends the MCP `initialize` request, and shows the answer, or the exit code and the last lines the server printed. When an entry fails but a direct `node` launch works, it prints a `claude mcp add` line you can use instead.

Run it in the folder where your MCP client runs, because local and project entries depend on it. An entry in `./.mcp.json` comes with the folder, for example with a cloned repo, so doctor shows its command and asks before starting it. It asks the same way whenever the folder decides what would run: for a command given as a path inside the folder, for `npx` or another package runner next to a `package.json`, `node_modules` or `.npmrc`, and on Windows for a file in the folder named like the command. Without a terminal it skips such entries unless you pass `--yes`. Values of environment variables in the config are never printed, only their names, and neither are values filled in from `${VAR}`. Each launch may take up to 10 seconds; raise that with `--timeout`, for example for `npx` on its first run.

On Windows, a command without an extension, such as `ldesk` or `npx`, is started through `cmd.exe` so that its `.cmd` or `.exe` file is found on PATH.

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
ldesk help-center collection list|create|update|move|publish|toggle|reorder|delete
ldesk articles list|visibility|get|create|update|sync|set-status|move|reorder|linkable|link-translation|unlink-translation|delete
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
ldesk help-center collection move 1 5 --parent-id null --yes
ldesk help-center tree 1
ldesk help-center collection publish 1 '[5,6,7]' --is-published --yes
ldesk help-center toggle 1 --yes
```

Creating or updating a collection with `--is-published` or `--no-is-published` asks for confirmation, like `publish` and `toggle`, because it changes what the public help center shows. So does moving a collection, with `collection move` or `collection update --parent-id`, because a collection moved under a published parent becomes public. Setting `--custom-css`, `--custom-js` or `--custom-domain` on a help center asks too, because that code and domain serve the public pages. `collection publish` sets a known state for one collection or a JSON list of ids; `collection toggle` flips it. An article reaches AI assistants only when every collection above it is published.

## Articles

Article content is markdown. Pass it inline or read it from a file:

```bash
ldesk articles create 3 --title "Reset your password" --content @article.md
ldesk articles update 12 --title "How to reset your password"
ldesk articles set-status 12 --status published --yes
ldesk articles set-status '[12,13,14]' --status published --yes
ldesk articles get 12
```

`ldesk articles create <collection-id>` makes a draft with `ai_enabled` on. To publish it, use `set-status`, or pass `--status published` to `create`. Both ask for confirmation, because a published article is public and used by the AI assistants.

`articles move` asks for confirmation as well: the article keeps its status, so a published article moved into a published collection becomes public.

`set-status` takes one id or a JSON list of ids. With a list it prints how many succeeded and failed, and one line per id.

Writes print a short record (id, title, slug, status, `ai_enabled`). Use `get` to see the whole article.

### Slugs

LibreDesk makes the slug from the title when the article is created, and keeps it when the title changes later. You can't set it yourself. It drops accents, so a German "ä" becomes "a", not "ae".

### Markdown and HTML

LibreDesk stores article bodies as HTML. `ldesk` converts your markdown to HTML when writing and back to markdown when reading.

- For what markdown can't express, such as tables, pass `--format html`. `create` and `update` then send the content unchanged, and `get --format html` returns the stored HTML.
- When `get` finds markup that would not survive the conversion back to markdown, it returns the HTML and sets `content_format` to `html`.
- A literal `~` reads back as `&#126;`. `~~text~~` is strikethrough.

### Updates

Updates only need the id and the fields that change. LibreDesk replaces the whole record on every update, so `ldesk` first reads the current record and sends it back with your changes applied. Changing the title does not reset `ai_enabled`, `status`, `content`, `excerpt` or the collection.

## Syncing a folder of articles

`ldesk articles sync <path>` creates or updates articles from a `.md` file or from the `.md` files of a folder (not its subfolders). Each file is one article, with its settings in frontmatter:

```markdown
---
collection_id: 7
excerpt: How refunds work
sort_order: 2
---
# Refunds

Orders can be returned within 30 days.
```

The frontmatter takes one `key: value` per line. The keys are `title`, `collection_id`, `excerpt`, `sort_order`, `ai_enabled`, `locale`, `meta_title`, `meta_description`, `meta_image_url`, `format` (`markdown` or `html`) and `id`. Without `title`, a leading `# heading` becomes the title. `--collection-id` sets the collection for files that have no `collection_id`.

```bash
ldesk articles sync ./help --collection-id 7 --dry-run   # only report what would change
ldesk articles sync ./help --collection-id 7
ldesk articles set-status '[41,42,43]' --status published --yes
```

How a run treats each file:

- **No `id`:** sync creates a draft and writes `id: <new id>` into the file's frontmatter. The next run then updates that article instead of creating another one.
- **With `id`:** sync compares the file with the article and writes only when something differs. A different `collection_id` moves the article; over MCP that file fails instead, and the model has to use `article_move`, which clients can keep on ask. Keys you leave out keep their value on the server.
- **Status:** sync never publishes or unpublishes. A `status` key is an error; publish afterwards with `set-status`.

It prints the totals and one line per file. A failing file does not stop the others.

## What AI assistants can see

`ldesk articles visibility <help-center-id>` lists which articles LibreDesk's AI assistants can use, and for each hidden one why: it is a draft, `ai_enabled` is off, a collection above it is unpublished, or the help center is offline. All four must hold for an article to be used. LibreDesk re-indexes an article in the background right after a change and checks every article again once a minute.

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
