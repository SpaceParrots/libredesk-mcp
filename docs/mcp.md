# MCP server

`ldesk serve` starts an MCP server on stdio. MCP clients such as Claude Code and Claude Desktop launch it and give the model tools to work with your LibreDesk.

## Setup

The server needs a LibreDesk login. There are two ways to give it one.

### With a stored login (recommended)

Run `ldesk login` once. The server then uses that login, and the API secret never appears in a client config file.

In Claude Code:

```bash
claude mcp add libredesk -- ldesk serve
```

If you have more than one profile, pin one with `LIBREDESK_PROFILE`:

```bash
claude mcp add libredesk -e LIBREDESK_PROFILE=helpdesk-example-com -- ldesk serve
```

Without `LIBREDESK_PROFILE`, the server uses the profile linked to the folder it runs in, or else the active profile. See [Profiles](cli.md#profiles).

### With environment variables

Put the credentials into the client config instead. This needs no `ldesk login`, but the secret is then stored in that file.

```bash
claude mcp add libredesk -e LIBREDESK_URL=https://helpdesk.example.com -e LIBREDESK_API_KEY=<your-api-key> -e LIBREDESK_API_SECRET=<your-api-secret> -- ldesk serve
```

### Config file

Clients that use a JSON file, such as `.mcp.json` in a project for Claude Code, take the same settings:

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

Replace the `env` block with `LIBREDESK_URL`, `LIBREDESK_API_KEY` and `LIBREDESK_API_SECRET` to pass credentials directly, or leave it out to use the active profile.

### Claude Desktop

Claude Desktop reads `claude_desktop_config.json` (Settings, Developer, Edit Config). It often does not see the PATH of your shell, so run the server through `npx`, or set `command` to the full path of `ldesk`:

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

### Let ldesk write the config

`ldesk mcp install` writes the entry into `./.mcp.json` and keeps every other server in the file:

```bash
ldesk mcp install                       # use the active profile, pinned with LIBREDESK_PROFILE
ldesk mcp install --npx                 # run through npx instead of a global ldesk
ldesk mcp install --toolsets knowledge  # also set LIBREDESK_TOOLSETS
ldesk mcp install --mode env --yes      # copy the credentials into the file
ldesk mcp install --scope print         # only print the entry, for another client
```

`--mode env` writes the API secret into `.mcp.json`, a file that is often committed, so it asks first. `--scope print` shows the placeholder `<your-api-secret>` unless you add `--show-secret`.

### When it does not connect

Run `ldesk doctor` in the folder where the client runs. It starts each LibreDesk entry of `~/.claude.json` and `./.mcp.json` exactly as configured and shows the answer or the error. It asks first when the folder decides what would run: an entry from `./.mcp.json`, a command path inside the folder, or `npx` next to a `package.json` or `node_modules`. When an entry fails but a direct `node` launch works, it prints a `claude mcp add` line you can use instead. See [Checking the setup](cli.md#checking-the-setup).

## Tools

Each tool takes an `action` and that action's fields, plus an optional `profile` to use another stored login for one call.

| Tool | What it does |
| --- | --- |
| `libredesk_help_center` | Help centers and collections: list, create, edit, reorder. |
| `libredesk_articles` | Articles: list, read, create drafts, edit, translate, sync from files, check visibility. |
| `libredesk_ai_knowledge` | AI snippets and FAQ suggestions. |
| `libredesk_lookup` | Read-only lookups of ids: agents, teams, inboxes, tags, statuses and more. |
| `libredesk_publish` | Changes what customers and AI assistants see, or what costs money: publish articles and collections, move them into another collection, put a help center online or offline, switch FAQ learning on or off. |
| `libredesk_delete` | Deletes help centers, collections, articles and snippets. |
| `libredesk_request` | Finds any other endpoint (`catalog`) and calls it (`call`). |
| `libredesk_status` | Shows the profile in use and whether the server answers. |

A few things worth knowing:

- The first four tools cannot publish. `create` always makes a draft, and publishing goes through `libredesk_publish`, and so does moving an article or collection (`article_move`, `collection_move`), because a move under a published collection can make it public. Their edits still take effect at once, also on an article that is already published.
- Custom CSS, custom JavaScript and the custom domain of a help center are not fields of `libredesk_help_center`. Set them in the CLI, which asks first, or with `libredesk_request`.
- `article_set_status` and `collection_publish` take one id or a list of up to 100, and report success or the error for each id.
- Writes return a short record (id, title, slug, status, `ai_enabled`, `updated_at`) instead of repeating the content the model just sent. `get` returns the full record.
- The `sync` action of `libredesk_articles` reads markdown files from the machine the server runs on and creates or updates articles from them, so long texts never pass through the model. It reads only below the folder the server runs in, or below `LIBREDESK_SYNC_ROOT` when that is set, and skips symbolic links. The file format is described in [Syncing a folder of articles](cli.md#syncing-a-folder-of-articles).
- The `visibility` action lists which articles the AI assistants can use and why the others are hidden.

## Permissions

MCP clients decide per tool whether to ask you before a call. Because publishing and deleting have their own tools, you can allow the everyday tools once and still be asked before an article or collection is published, a help center goes online or offline, or anything is deleted. In Claude Code, add this to `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["mcp__libredesk__libredesk_help_center", "mcp__libredesk__libredesk_articles", "mcp__libredesk__libredesk_ai_knowledge", "mcp__libredesk__libredesk_lookup", "mcp__libredesk__libredesk_status"],
    "ask": ["mcp__libredesk__libredesk_publish", "mcp__libredesk__libredesk_delete", "mcp__libredesk__libredesk_request"]
  }
}
```

Allowing the everyday tools still lets the model change live content without asking: edits to an article that is already published, help center names and settings, and snippets, which assistants use as soon as they are enabled. Allow them only where you are fine with that, or keep `libredesk_help_center` and `libredesk_ai_knowledge` on ask.

The tools also carry the MCP hints `readOnlyHint`, `destructiveHint` and `idempotentHint`, and the server tells the model to confirm publishing and deleting with you first. `libredesk_publish` is marked destructive too, because it can take a help center offline, so clients that ask before destructive tools ask there as well.

Every tool takes a `profile` argument. If one server should only reach some of your stored profiles, list them in `LIBREDESK_MCP_PROFILES` (comma-separated); a call naming any other profile fails. The profile the server starts with is always allowed.

## What AI assistants can see

An article reaches LibreDesk's AI assistants only when all four of these hold:

1. The article is published.
2. Its `ai_enabled` setting is on.
3. Every collection above it is published.
4. The help center is online.

LibreDesk re-indexes an article in the background right after a change and checks all articles again every minute.

## Toolsets

`LIBREDESK_TOOLSETS` limits which domain tools are registered, as a comma-separated list:

- `knowledge`: help centers, articles and AI knowledge.
- `ai`, `workflow`, `support`: reserved for later versions.
- `all`: every toolset.

When it is not set, every toolset except `support` is on. `libredesk_lookup`, `libredesk_request` and `libredesk_status` are always registered. `libredesk_request` can reach every endpoint, including those of a toolset that is switched off. An unknown name stops the server with a message that lists the valid ones.

```json
{ "env": { "LIBREDESK_TOOLSETS": "knowledge" } }
```
