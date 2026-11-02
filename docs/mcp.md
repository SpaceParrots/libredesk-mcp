# MCP server

`ldesk serve` runs the MCP server on stdio. It registers one tool per domain, each with an `action` field:

- `libredesk_help_center`: help centers and collections.
- `libredesk_articles`: articles.
- `libredesk_ai_knowledge`: snippets, FAQ suggestions and the learning setting.
- `libredesk_lookup`: read-only lookups of ids.
- `libredesk_request`: `catalog` finds an endpoint, `call` sends a raw request.
- `libredesk_status`: the profile in use and whether its server answers.

Every tool takes an optional `profile`. Actions that change public pages, delete data or cost money are marked caution or destructive, and the server instructions tell the model to confirm them with you first.

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
