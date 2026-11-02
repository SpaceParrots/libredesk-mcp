# MCP server

`ldesk serve` runs the MCP server on stdio. It registers one tool per domain for reading and for writing drafts, two shared tools for the risky actions of every domain, and two helpers. Each takes an `action` field:

- `libredesk_help_center`: help centers and collections.
- `libredesk_articles`: articles.
- `libredesk_ai_knowledge`: snippets and FAQ suggestions.
- `libredesk_lookup`: read-only lookups of ids.
- `libredesk_publish`: what customers and AI assistants see, and paid switches: `article_set_status`, `collection_publish`, `help_center_toggle`, `learning_set`.
- `libredesk_delete`: `help_center_delete`, `collection_delete`, `article_delete`, `snippet_delete`.
- `libredesk_request`: `catalog` finds an endpoint, `call` sends a raw request.
- `libredesk_status`: the profile in use and whether its server answers.

Every tool takes an optional `profile`. The domain tools cannot publish: `articles create` always makes a draft, and collections are published with `collection_publish`. `article_set_status` and `collection_publish` take one id or a list of up to 100, and return an ok or error entry per id.

Writes return a short record (id, title, slug, status, `ai_enabled`, `updated_at`), not the content just sent; `get` returns the whole record.

## Permissions

Clients decide per tool name whether to ask before a call. Because publishing and deleting live in their own tools, you can allow the domain tools once and keep a confirmation on the rest. In Claude Code, `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["mcp__libredesk__libredesk_help_center", "mcp__libredesk__libredesk_articles", "mcp__libredesk__libredesk_ai_knowledge", "mcp__libredesk__libredesk_lookup", "mcp__libredesk__libredesk_status"],
    "ask": ["mcp__libredesk__libredesk_publish", "mcp__libredesk__libredesk_delete", "mcp__libredesk__libredesk_request"]
  }
}
```

The tools also carry the MCP hints `readOnlyHint`, `destructiveHint` and `idempotentHint`, and the server instructions tell the model to confirm publishing and deleting with you first.

## What AI assistants can see

An article reaches LibreDesk's AI assistants only when all of these hold: it is published, `ai_enabled` is on, every collection above it is published, and the help center is online. LibreDesk re-indexes an article in the background right after a change and checks all of them again every minute.

## Setup with a stored login

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

## Setup with environment variables

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

## Claude Desktop

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

## `ldesk mcp install`

`ldesk mcp install` writes the entry into `./.mcp.json` for you and keeps the other servers and keys in the file.

```bash
ldesk mcp install                       # pin the active profile with LIBREDESK_PROFILE
ldesk mcp install --mode env --yes      # copy the credentials into the file
ldesk mcp install --npx                 # run through npx instead of a global ldesk
ldesk mcp install --toolsets knowledge  # also set LIBREDESK_TOOLSETS
ldesk mcp install --scope print         # print the snippet for another client
```

`--mode env` writes the API secret into `.mcp.json`, which is often committed, so it asks first and needs `--yes` without a terminal. `--scope print` hides the secret behind the placeholder `<your-api-secret>`. Add `--show-secret` to print the real one.

## Toolsets

`LIBREDESK_TOOLSETS` picks which domain tools are registered, as a comma separated list of:

- `knowledge`: help center, articles and AI knowledge.
- `ai`, `workflow`, `support`: reserved for later phases.
- `all`: every toolset.

Unset, every toolset except `support` is on. The `core` toolset (lookup) is always on, and so are `libredesk_request` and `libredesk_status`. `libredesk_request` can reach every operation, including those of a toolset that is switched off. An unknown name stops the server with a message listing the valid ones.

```json
{ "env": { "LIBREDESK_TOOLSETS": "knowledge" } }
```
