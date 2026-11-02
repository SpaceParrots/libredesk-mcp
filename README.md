# libredesk-mcp

[![npm](https://img.shields.io/npm/v/@spaceparrots/libredesk-mcp)](https://www.npmjs.com/package/@spaceparrots/libredesk-mcp) [![CI](https://github.com/SpaceParrots/libredesk-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/SpaceParrots/libredesk-mcp/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Manage the knowledge base of your [LibreDesk](https://libredesk.io) helpdesk from the terminal or from an AI assistant such as Claude.

The package ships two things:

- **`ldesk`**, a command line tool for help centers, articles and the knowledge LibreDesk's AI assistants answer from.
- **An MCP server**, so Claude and other MCP clients can do the same work for you: draft articles, review FAQ suggestions, or check why an article is not used by your AI assistant.

## What you can do

- Write and edit help center articles in **markdown**. LibreDesk stores HTML; `ldesk` converts in both directions.
- **Sync a folder of markdown files** to articles. Run it again and only the changed articles are updated.
- Manage help centers and collections, and publish or unpublish many articles at once.
- Maintain AI snippets, import a web page as a snippet, and approve or reject FAQ suggestions.
- See **which articles your AI assistants can use**, and the reason for each one they can't.
- Look up the ids of agents, teams, inboxes and other settings, and send a raw request to any other endpoint.

## Requirements

- Node.js 22.12 or newer.
- LibreDesk 2.9.2. Other versions may work; see [API coverage](docs/api-coverage.md).
- An API key and secret for a LibreDesk agent. The agent's role decides what you can do, for example `help_center:manage` for articles and `ai:manage` for snippets.

## Install

```bash
npm install -g @spaceparrots/libredesk-mcp
```

## Quick start

Log in once. `ldesk` checks the credentials and stores them as a profile; it asks for the secret without showing it.

```bash
ldesk login --url https://helpdesk.example.com --api-key <key>
ldesk status
```

Then work with your content:

```bash
ldesk help-center list
ldesk articles create 3 --title "Reset your password" --content @article.md
ldesk articles set-status 12 --status published
ldesk knowledge snippet create --title "Refunds" --content @refunds.txt
```

`@article.md` reads the value from a file. Run `ldesk` without arguments for an interactive menu, or add `--help` to any command for its options and examples.

## Use it with Claude

Add the server to your MCP client. For Claude Code, run this in your project:

```bash
claude mcp add libredesk -- npx -y @spaceparrots/libredesk-mcp serve
```

For Claude Desktop, or to configure it by hand, add this to `claude_desktop_config.json` or to `.mcp.json` in your project:

```json
{
  "mcpServers": {
    "libredesk": {
      "command": "npx",
      "args": ["-y", "@spaceparrots/libredesk-mcp", "serve"]
    }
  }
}
```

The server uses the login you stored with `ldesk login`, so the secret stays out of the config file. To pass credentials directly instead, add an `env` block with `LIBREDESK_URL`, `LIBREDESK_API_KEY` and `LIBREDESK_API_SECRET`. [MCP server](docs/mcp.md) has all setup variants.

Then ask in plain language, for example:

- "List the articles in our help center that the AI assistant can't see, and why."
- "Draft an article about changing the delivery address from this email thread."
- "Go through the pending FAQ suggestions and approve the ones that are correct."

If the client can't connect, run `ldesk doctor` in the folder where the client runs. It starts the server the same way the client does and tells you what went wrong.

## Safe by default

- **Drafts first.** New articles are drafts. Publishing, taking a help center offline, enabling FAQ learning and deleting are separate steps that ask for confirmation.
- **Separate tools for risky actions.** Over MCP, publishing and deleting live in their own tools, `libredesk_publish` and `libredesk_delete`, so your client can ask you before each one. Edits made with the other tools take effect at once, so editing an already published article changes the live page. See [Permissions](docs/mcp.md#permissions).
- **Updates keep your data.** LibreDesk replaces a whole record on every update. `ldesk` reads the current record first, so changing a title never resets the content or the AI setting.
- **Secrets stay hidden.** The API secret is stored in `~/.libredesk-mcp/config.json` (file mode 0600 on macOS and Linux) and is masked in all output.

## Documentation

- [CLI reference](docs/cli.md): logging in, profiles, every command, syncing a folder.
- [MCP server](docs/mcp.md): setup for Claude Code and Claude Desktop, tools, permissions.
- [API coverage](docs/api-coverage.md): which LibreDesk version is targeted and which endpoints are undocumented.
- [Development](docs/development.md): building, testing against a local LibreDesk, adding an endpoint.

## Contributing

Bug reports and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). To report a security problem, see [SECURITY.md](SECURITY.md).

This project is not affiliated with LibreDesk. Many of the endpoints it uses are not part of LibreDesk's documented API and may change between LibreDesk releases.

## License

[MIT](LICENSE)
