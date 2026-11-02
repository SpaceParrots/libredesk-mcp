# Development

```bash
npm install
npm run build          # compile to dist/
npm run dev -- status  # run from source with tsx
npm run verify         # lint, typecheck and unit tests
npm run test:coverage  # unit tests with 80% coverage thresholds
```

[CLAUDE.md](../CLAUDE.md) describes the architecture and the rules the code follows in more detail. It is written for coding agents, but it is the most complete overview for people too.

## How the code is organised

Every LibreDesk endpoint is declared once, as an operation in a file under `src/domains/`. Everything else is generated from those declarations:

- the `ldesk` commands and their `--help`,
- the interactive mode,
- the MCP tools and their actions,
- the catalog behind `ldesk catalog` and the `libredesk_request` tool.

`src/http.ts` is the only code that talks to the network. `src/ops/run.ts` validates input, builds the request and runs it. Hand-written commands such as `login`, `status` and `doctor` live in `src/commands/`, with their logic in `src/services/`.

## Adding an operation

1. Add a `defineOperation({ name, summary, method, path, input, impact, ... })` to the domain file. `input` is a zod shape with a `.describe()` on every field. `impact` is `read`, `write`, `caution` (publishes, takes something offline or costs money) or `destructive` (deletes); the last two also need an `effect` that says what happens. Set `undocumented: true` when the shape comes from the LibreDesk source rather than its API spec.
2. Add help for the CLI with the optional `cli` property: `examples` (one to three complete `ldesk ...` commands that run without a terminal; `tests/cli/examples.test.ts` runs each one), `notes`, `hidden` fields, and `flags` for the on and off text of a boolean flag. This text appears only in `--help`, so it does not make the MCP tool definitions longer.
3. When only some inputs make an operation risky, add `escalate` (`when`, `condition`, `impact`, `effect`) instead of raising `impact`. For example, `articles create` asks for confirmation only when `status` is `published`. List the optional fields that cause it in `escalate.fields`: the MCP domain tool then leaves them out, and the risky path is only reachable through `libredesk_publish`.
4. Add the operation to the domain's `operations` array. An operation with a `group` needs a description of that group in the domain's `groups`.
5. Add unit tests in `tests/domains/` and, when the endpoint exists in LibreDesk 2.9.2, a live test in `tests/live/`.
6. Run `npm run verify`. It includes a test that bounds the size of the MCP tool definitions, because clients send them to the model with every request. If it fails, shorten descriptions rather than raising the bound.

Over MCP, an operation with `impact` `caution` becomes an action of the shared `libredesk_publish` tool, and one with `destructive` an action of `libredesk_delete`, instead of an action of its domain tool. `mcpTool: "publish"` moves any other operation there too. The action is named `<actionPrefix>_<name>`, or keeps its name when it already belongs to a group, such as `collection_publish`.

For a new domain, create `src/domains/<name>.ts` exporting a `Domain` (with `name`, `tool`, `actionPrefix`, `toolset`, `summary` and `operations`) and add it to `DOMAINS` in `src/domains/index.ts`.

## Local LibreDesk and live tests

A compose file starts LibreDesk 2.9.2 with its database on `http://localhost:9000`. It needs Docker.

```bash
npm run dev:up         # start the stack
npm run dev:bootstrap  # create the agent ldesk-dev@example.com and an API key
npm run test:live      # run the live tests against it
npm run dev:down       # stop it, keeping its data
```

`dev:bootstrap` prints three `LIBREDESK_*` lines and also writes them to a git-ignored file in the repo root. Load them into your shell, with a throwaway config folder so the tests never touch your real profiles:

```bash
export LIBREDESK_CONFIG_DIR="$(mktemp -d)"
set -a; eval "$(node dev/bootstrap.mjs 2>/dev/null)"; set +a
npm run test:live
```

The live tests create and delete their own data. To run them against a production instance, set `LIBREDESK_LIVE_SCOPE=readonly`; they then create, change and delete nothing.

## Releases

Releases are made by [release-please](https://github.com/googleapis/release-please). Commits on `main` follow [Conventional Commits](https://www.conventionalcommits.org/), and release-please collects them into a release pull request that bumps the version and updates `CHANGELOG.md`. Merging that pull request tags the release.
