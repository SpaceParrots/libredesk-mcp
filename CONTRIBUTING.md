# Contributing

Thanks for helping. Bug reports, fixes and support for more LibreDesk endpoints are all welcome.

## Reporting a bug

Open an [issue](https://github.com/SpaceParrots/libredesk-mcp/issues) with:

- the `ldesk --version` and your LibreDesk version,
- the command or MCP action you ran, and what you expected,
- the output, with `--json` if it helps. Check that it contains no API secret or customer data before you post it.

If the MCP server does not start in your client, include the output of `ldesk doctor`.

## Pull requests

1. Fork the repo and create a branch from `main`.
2. Run `npm install`, make your change, and add tests for it.
3. Run `npm run verify` (lint, typecheck and unit tests). It has to pass.
4. Write the commit message as a [Conventional Commit](https://www.conventionalcommits.org/), for example `fix(articles): keep the excerpt when moving an article`. Releases and the changelog are generated from these messages.
5. Open the pull request against `main` and describe what changed and why.

Keep a pull request to one change. For a larger change, or a new domain, open an issue first so we can agree on the approach.

[Development](docs/development.md) explains how the code is organised, how to add an endpoint, and how to run the live tests against a local LibreDesk in Docker.

## Endpoints that LibreDesk does not document

Many endpoints this tool uses, such as those for help centers and articles, are not in LibreDesk's published API spec. Their request and response shapes come from the LibreDesk source code of the targeted version. When you add or change one, read the handler in the [LibreDesk repository](https://github.com/abhinavxd/libredesk) at the matching tag rather than guessing field names, and mark the operation `undocumented: true`.
