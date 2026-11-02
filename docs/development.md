# Development

```bash
npm install
npm run build          # compile to dist/
npm run dev -- status  # run from source with tsx
npm run verify         # lint, typecheck and unit tests
npm run test:coverage  # coverage with 80% thresholds
```

`CLAUDE.md` describes the architecture and the rules an operation has to follow.

## Local LibreDesk stack and live tests

A compose file starts LibreDesk 2.9.2 with its database on `http://localhost:9000`.

```bash
npm run dev:up         # start the stack
npm run dev:bootstrap  # create the agent ldesk-dev@example.com and an API key
npm run test:live      # run the live tests against it
npm run dev:down       # stop it, keeping its data
```

`dev:bootstrap` prints the three `LIBREDESK_*` lines and also writes them to a git-ignored env file in the repo root. Load them into the shell, with a throwaway config dir, before running the live tests:

```bash
export LIBREDESK_CONFIG_DIR="$(mktemp -d)"
set -a; eval "$(node dev/bootstrap.mjs 2>/dev/null)"; set +a
npm run test:live
```

The live tests create and delete their own data. To run them against a production instance, set `LIBREDESK_LIVE_SCOPE=readonly` so they create, change and delete nothing.

## Adding an operation

Every endpoint is declared once with `defineOperation` in a file under `src/domains/`. The CLI command, the interactive prompts, the MCP action and the catalog entry are generated from that declaration.

1. Add a `defineOperation({ name, summary, method, path, input, impact, ... })` to the domain file. `input` is a zod shape with a `.describe()` on every field. Set `undocumented: true` when the shape comes from the LibreDesk source.
2. Add CLI help with the optional `cli` property: `examples` (full `ldesk ...` commands), `notes` and `hidden` fields. It appears only in `--help`, so it costs the MCP tool definitions nothing.
3. Add it to the `operations` array of the domain.
4. For a new domain, create `src/domains/<name>.ts` that exports a `Domain` and add it to `DOMAINS` in `src/domains/index.ts`.
5. Add a unit test and, when the endpoint exists on 2.9.2, a live test.
6. Run `npm run verify`.
