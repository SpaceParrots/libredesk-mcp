# CLAUDE.md

Guidance for agents working in this repository.

## Project overview

`@spaceparrots/libredesk-mcp` is a CLI (`ldesk`) and MCP server for the LibreDesk helpdesk API. Target version: LibreDesk 2.9.2 (`LIBREDESK_TARGET_VERSION` in `src/constants.ts`). Phase 1 covers help centers, articles, AI snippets and FAQ suggestions, read-only lookups, a raw request tool and status. TypeScript strict, ESM with Node16 resolution (relative imports end in `.js`), zod 4, vitest, eslint with `unicorn/filename-case`.

## Commands

```bash
npm run build          # tsc to dist/
npm run dev -- <args>  # run from source with tsx
npm run lint           # eslint src/ tests/
npm run typecheck      # tsc for src and tests
npm test               # unit tests
npm run verify         # lint + typecheck + test; run before every commit that touches src/
npm run test:coverage  # 80% thresholds
npm run test:live      # live tests against a real instance
npm run docs:undocumented  # list undocumented operations; needs a build first
npm run dev:up / dev:down / dev:bootstrap  # local LibreDesk stack on http://localhost:9000
```

## Architecture

Every endpoint is declared once as an `Operation` (`src/ops/define.ts`, built with `defineOperation`). Everything else is generated from those declarations:

- `src/domains/*.ts` group operations into a `Domain` (one CLI command, one MCP tool). `src/domains/index.ts` exports `DOMAINS`.
- `src/cli/domain-commands.ts` generates the Commander commands, `src/cli/interactive.ts` the interactive menu, `src/mcp/domain-tool.ts` and `src/mcp/action-tool.ts` the MCP tools, `src/ops/catalog.ts` the catalog.
- `src/ops/run.ts` validates input (strict zod), builds the request (path params, query, body), runs a custom `run` if the operation has one, applies `present`, and maps errors.
- `src/ops/merge.ts` has `mergeForUpdate`, the read-modify-write helper for updates.
- `src/http.ts` is the only code that talks to the network: auth header `Authorization: token <key>:<secret>`, base URL normalisation, response envelope unwrapping, readable errors for non-JSON responses.
- `src/config.ts`, `src/context.ts` store profiles and resolve the one in effect (flag, the three env vars, `LIBREDESK_PROFILE`, project link, active profile).
- `src/commands/*` are the hand-written commands: login, profile, status, request, mcp.
- `src/services/*` hold the logic behind those commands, kept free of printing.
- `src/mcp/server.ts` registers the tools, reads `LIBREDESK_TOOLSETS`, and starts stdio. `src/mcp/instructions.ts` is the text clients put into the model's system prompt.
- `src/content/markdown.ts` converts article content between markdown and the HTML LibreDesk stores.
- `src/mask.ts` masks secrets; every printed or returned value goes through it.

`src/index.ts` runs interactive mode with no arguments on a terminal, the MCP server with no arguments otherwise, and the Commander program for anything else.

## Adding an operation

1. Add a `defineOperation` to the domain file, with `name` (snake_case, unique per domain), `summary`, `method`, `path`, `input` (zod shape, `.describe()` on every field), `impact` and, for `caution` or `destructive`, an `effect`. Add `permission` when you know the role permission the endpoint needs.
2. Put it in the domain's `operations` array.
3. Add unit tests in `tests/domains/` and, when 2.9.2 has the endpoint, a live test in `tests/live/`.
4. Run `npm run verify`, and the token budget test with it.

A new domain is a file in `src/domains/` exporting a `Domain` (`name` kebab-case, `tool` as `libredesk_<domain>`, `toolset`, `summary`, `operations`) plus an entry in `DOMAINS`. The CLI command, the MCP tool and the catalog follow with no other change.

## Rules learned in this phase

- LibreDesk PUT endpoints replace the whole record: a field missing from the body is reset (a missing `ai_enabled` becomes `false`). Updates read the current record, then send the exact key set the server handler writes, with the caller's changes applied (`mergeForUpdate`). A test whose name ends with `keeps fields the caller did not pass` pins this for each updatable record (collections are pinned by `collection_update merges from the collection list`).
- `defineOperation` enforces that every field of a GET or DELETE is a path parameter or a query field, because those requests have no body. A field that would be dropped silently fails at load. Operations with a custom `run` are exempt.
- Do not annotate the parameters of a `run` or `present` callback. They are typed from `input`, and an annotation breaks the inference or makes the operation unassignable to `Operation`.
- Validation is strict: unknown keys are rejected in `run.ts` and in the MCP action tool, with an error naming them. Do not loosen it to be forgiving.
- The MCP tool definitions are always on in the model's context, so `tests/mcp/token-budget.test.ts` bounds them: measured size plus about 10 percent, with a hard bound of `9_000` characters for the default toolsets. Keep descriptions short. Do not raise the bound to make a test pass; shorten the descriptions or move text into the response.
- In the MCP path, never write to stdout. Stdout carries the protocol, so a stray `console.log` or a prompt corrupts it. Diagnostics go to stderr. The CLI prints only through `src/cli/output.ts`.
- Non-interactive runs never wait: with no TTY, missing required fields and unconfirmed `caution` or `destructive` operations fail with a message naming the fields or `--yes`.
- Never put the API secret into an error message, `status` output, `--json` output or a log. `mcp install --scope print` shows a placeholder unless `--show-secret` is given.
- Every operation built from the LibreDesk source rather than the documented OpenAPI spec has `undocumented: true`. `docs/api-coverage.md` lists them; regenerate with `npm run docs:undocumented` after a build and update that file.
- Shapes of undocumented endpoints come from the LibreDesk v2.9.2 source: a fresh clone of tag `v2.9.2` (`git clone --depth 1 --branch v2.9.2 https://github.com/abhinavxd/libredesk.git`). Read the handler and request struct (`cmd/*.go`, `internal/*/models`), do not guess field names or required fields.
- Article content is markdown by default; stored HTML that markdown would lose comes back as HTML with `content_format: "html"`.
- New articles default to `draft` with `ai_enabled` true. Publishing goes through `set_status`.
- Files open with a JSDoc `@module` block and every export has a JSDoc comment. File names are kebab-case. Service inputs and config objects are `readonly`, and config changes return new objects.
- Commits are Conventional Commits, one line, no co-author line. Markdown files have one line per paragraph and no hard wrapping.
- Helper scripts are plain `node` `.mjs` files or POSIX sh, so they work on every OS. `scripts/list-undocumented.mjs` imports from `dist/`.

## Live tests

Unit tests mock `fetch`. Live tests (`tests/live/*.live.test.ts`, config in `vitest.live.config.ts`) run against a real LibreDesk and run one file at a time.

```bash
npm run dev:up
export LIBREDESK_CONFIG_DIR="$(mktemp -d)"
set -a; eval "$(node dev/bootstrap.mjs 2>/dev/null)"; set +a
npm run test:live
```

`dev/bootstrap.mjs` creates the agent `ldesk-dev@example.com` with the Admin role, makes a fresh API key and prints the three `LIBREDESK_*` lines, which also go to `.env.live`. Do not read `.env.live` or print the secret. Point `LIBREDESK_CONFIG_DIR` at a temp directory so a test run never touches the real profiles.

Live tests create and remove their own data. With `LIBREDESK_LIVE_SCOPE=readonly` they must create, change and delete nothing, which is what a run against production uses. A live test that writes has to check `writesAllowed()` from `tests/live/helpers.ts`.
