# libredesk-mcp

CLI tool (`ldesk`) and MCP server for the [LibreDesk](https://libredesk.io) helpdesk API. Manage help centers, knowledge base articles and the knowledge your AI assistants answer from, from the terminal or through Claude.

It covers help centers and collections, articles (written and read as markdown), AI snippets, FAQ suggestions, read-only lookups of ids, and a raw request for every other endpoint.

## Requirements

- Node.js 22.12 or newer.
- LibreDesk 2.9.2. Other versions may work; see [API coverage](docs/api-coverage.md).
- An API key and secret of an agent whose role allows what you want to do, for example `help_center:manage` and `ai:manage`.

## Install

```bash
npm install -g @spaceparrots/libredesk-mcp
```

## Quick start

```bash
ldesk login --url https://helpdesk.example.com --api-key <key>   # asks for the secret
ldesk status
ldesk help-center list
ldesk articles create 3 --title "Reset your password" --content @article.md
ldesk knowledge snippet create --title "Refunds" --content @refunds.txt
```

Run `ldesk` without arguments for an interactive menu, or `ldesk <command> --help` for the flags and examples of any command.

## Use it from Claude

Add the server to your MCP client config, for example `.mcp.json` in your project for Claude Code or `claude_desktop_config.json` for Claude Desktop:

```json
{
  "mcpServers": {
    "libredesk": {
      "command": "npx",
      "args": ["-y", "@spaceparrots/libredesk-mcp", "serve"],
      "env": {
        "LIBREDESK_URL": "https://helpdesk.example.com",
        "LIBREDESK_API_KEY": "<your-api-key>",
        "LIBREDESK_API_SECRET": "<your-api-secret>"
      }
    }
  }
}
```

The `env` block is optional. Leave it out and the server uses the login stored by `ldesk login`, which keeps the secret out of the config file. For more setup variants and to limit the tools, see [MCP server](docs/mcp.md).

## Documentation

- [CLI reference](docs/cli.md): profiles, conventions for scripts and agents, every command.
- [MCP server](docs/mcp.md): tools, setup variants, `ldesk mcp install`, toolsets.
- [API coverage](docs/api-coverage.md): target LibreDesk version and the endpoints taken from its source.
- [Development](docs/development.md): building, the local LibreDesk stack, live tests, adding an operation.

## License

MIT
