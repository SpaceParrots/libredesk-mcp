# Security

`ldesk` stores LibreDesk API credentials and acts on a helpdesk with them, so security reports matter to us.

## Reporting a problem

Please do not open a public issue for a security problem. Report it privately through [GitHub's vulnerability reporting](https://github.com/SpaceParrots/libredesk-mcp/security/advisories/new) instead. We aim to answer within a week.

Examples of what to report:

- a way the API secret ends up in output, logs, error messages or MCP results,
- a way an MCP client or a crafted response can make the tool read, write or send something it should not,
- anything that lets a request reach a different host than the configured LibreDesk.

Problems in LibreDesk itself belong to the [LibreDesk project](https://github.com/abhinavxd/libredesk).

## Supported versions

Fixes go into the latest release only. Update with `npm install -g @spaceparrots/libredesk-mcp@latest`.
