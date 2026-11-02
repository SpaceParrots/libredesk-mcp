# Phase 1: Foundation and Knowledge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@spaceparrots/libredesk-mcp` v0.1: the `ldesk` CLI and MCP server with login/profiles, the operation-definition core, and full management of the help center, articles, AI snippets and FAQ suggestions.

**Architecture:** Every LibreDesk endpoint is declared once as an `Operation` (zod input, method, path, impact). Three generators read those definitions: commander subcommands, one MCP action-dispatch tool per domain, and a clack-driven interactive mode. A small HTTP client on native `fetch` handles auth, the `{status, data}` envelope and error mapping.

**Tech Stack:** TypeScript (strict, ESM, Node16 modules), Node >=22.12, commander, @clack/prompts, @modelcontextprotocol/sdk, zod 4, marked, turndown, node-html-parser, vitest, eslint (typescript-eslint + unicorn), Docker Compose for a local LibreDesk.

**Spec:** `docs/superpowers/specs/2026-11-02-libredesk-cli-mcp-design.md`

**Reference code:** `D:\Tools\vex` (same author, same pattern for Vendure). LibreDesk v2.9.2 source: clone with `git clone --depth 1 --branch v2.9.2 https://github.com/abhinavxd/libredesk.git` into a folder outside this repo (for example `D:\SpaceParrots\_ref\libredesk`). Request shapes cited below come from `cmd/helpcenter.go`, `cmd/ai.go`, `cmd/aiagent.go`, `internal/helpcenter/helpcenter.go` (`HelpCenterRequest`, `CollectionRequest`, `ArticleRequest`), `internal/helpcenter/models/models.go`, `internal/ai/models/models.go`, `internal/aiagent/models/models.go`.

## Global Constraints

- Package `@spaceparrots/libredesk-mcp`, one binary `ldesk`, MIT licence, `"type": "module"`.
- Node engines `>=22.12.0`, `.nvmrc` `22`, CI matrix Node 22 and 24. (Changed from the spec's `^20.19.0 || >=22.12.0`: Node 20 reached end of life in April 2026.)
- Runtime dependencies: `commander`, `@clack/prompts`, `@modelcontextprotocol/sdk`, `zod` (v4), `marked`, `turndown`, `node-html-parser`. Nothing else without a reason written in the commit.
- `LIBREDESK_TARGET_VERSION = "2.9.2"` in `src/constants.ts`.
- Auth header: `Authorization: token <api_key>:<api_secret>`.
- Env vars: `LIBREDESK_URL`, `LIBREDESK_API_KEY`, `LIBREDESK_API_SECRET`, `LIBREDESK_PROFILE`, `LIBREDESK_TOOLSETS`, `LIBREDESK_CONFIG_DIR` (overrides the config dir, used by tests).
- Config file `~/.libredesk-mcp/config.json`, written atomically (temp file + rename) with mode `0o600`.
- Profile resolution order: `--profile`/`profile` param, then the three env vars when all are set (implicit profile named `env`), then `LIBREDESK_PROFILE`, then a project link matching the cwd, then the active profile.
- MCP tool names `libredesk_<domain>` snake_case; action names snake_case; CLI commands and flags kebab-case.
- Every source file opens with a JSDoc `@module` block; every export has a JSDoc comment; file names kebab-case (enforced by `unicorn/filename-case`).
- Service inputs and config objects are `readonly`; config changes return new objects.
- Every operation built from source rather than the documented OpenAPI spec carries `undocumented: true`.
- Secrets are masked in every printed or returned value (see Task 2).
- Commits: Conventional Commits, one line, no co-author line, e.g. `feat(articles): add markdown content support`. Run `npm run verify` before every commit that touches `src/`.
- Markdown files: one line per paragraph, no hard wrapping.
- Cross-platform: no PowerShell-only or bash-only scripts in the repo; helper scripts are plain `node` `.mjs`.

## Review Focus

1. **Partial updates wiping fields.** LibreDesk PUT endpoints replace the whole record (`UpdateArticle` writes every `ArticleRequest` field; a missing `ai_enabled` becomes `false`). A user who updates only an article's title expects `ai_enabled`, `status`, `content`, `excerpt` and the collection to stay as they were. Pinned in Tasks 8, 9 and 10 by `update keeps fields the caller did not pass`.
2. **Non-interactive runs.** When stdin is not a TTY (MCP client spawn, CI, a pipe), the CLI must never wait on a prompt: missing required fields and unconfirmed `caution`/`destructive` operations fail with a message naming the fields or the `--yes` flag. Pinned in Task 12.
3. **Messy base URLs and partial env config.** A URL with a trailing slash or a path prefix behind a reverse proxy (`https://example.com/helpdesk/`) must still produce `https://example.com/helpdesk/api/v1/...`; only two of the three `LIBREDESK_*` credential vars set must fail naming the missing one. Pinned in Tasks 3 and 4.
4. **Non-JSON error responses.** A reverse proxy returning an HTML 502 or a 413 must give a readable error with the status code, not a JSON parse crash. Pinned in Task 4.
5. **Secrets leaking through error paths.** Error messages, `status` output and `--json` output must never contain the API secret or the `Authorization` header value. Pinned in Tasks 2 and 4.

---

## File Structure

```
package.json, tsconfig.json, eslint.config.js, vitest.config.ts, vitest.live.config.ts
.gitignore, .nvmrc, LICENSE, README.md, CLAUDE.md
release-please-config.json, .release-please-manifest.json, .github/workflows/{ci,release-please}.yml
docker-compose.dev.yml               local LibreDesk v2.9.2 + Postgres 17 + Redis 7
dev/config.toml                      LibreDesk config for the local instance
dev/bootstrap.mjs                    creates an admin agent + API key on the local instance
src/index.ts                         entry: picks interactive, MCP server or commander
src/constants.ts                     version, env var names, defaults
src/errors.ts                        LibreDeskError hierarchy, toLibreDeskError
src/guards.ts                        isRecord
src/mask.ts                          maskSecrets
src/config.ts                        profile store (pure transforms + load/save)
src/context.ts                       profile resolution, withProfile
src/http.ts                          request(), buildUrl(), envelope + error mapping
src/content/markdown.ts              markdown <-> HTML for articles
src/ops/define.ts                    Operation, Domain, defineOperation, defineDomain
src/ops/fields.ts                    zod field introspection shared by CLI, prompts, catalog
src/ops/run.ts                       splitInput, runOperation
src/ops/catalog.ts                   buildCatalog
src/ops/merge.ts                     mergeForUpdate (read-modify-write helper)
src/domains/help-center.ts           help centers + collections
src/domains/articles.ts
src/domains/ai-knowledge.ts          snippets, FAQ suggestions, learning setting
src/domains/lookup.ts                read-only lookups
src/domains/index.ts                 DOMAINS
src/cli/prompt.ts                    PromptAdapter + clack implementation
src/cli/output.ts                    printResult, printSuccess, handleCliError
src/cli/flags.ts                     flagsFor, parseFlagValues
src/cli/confirm.ts                   confirmImpact, collectMissing
src/cli/domain-commands.ts           addDomainCommands
src/cli/program.ts                   createProgram (root + built-in commands)
src/cli/interactive.ts               runInteractive, commandLineFor
src/commands/login.ts, profile.ts, status.ts, request.ts, mcp.ts
src/services/auth.ts                 verifyCredentials
src/services/status.ts               getStatus
src/services/raw-request.ts          rawRequest (shared by CLI request + MCP request tool)
src/services/mcp-config.ts           buildServerEntry, mergeMcpJson (port of vex)
src/mcp/action-tool.ts               actionTool, dispatchAction, toolErrorResult (port of vex)
src/mcp/domain-tool.ts               registerDomainTool
src/mcp/request-tool.ts              registerRequestTool
src/mcp/status-tool.ts               registerStatusTool
src/mcp/instructions.ts              SERVER_INSTRUCTIONS
src/mcp/server.ts                    selectDomains, registerTools, startMcpServer
tests/...                            mirrors src/; tests/live/*.live.test.ts for the local instance
```

Domains are single files in phase 1. A domain that outgrows ~400 lines becomes a folder (`src/domains/<name>/index.ts` plus files per group) without changing its export.

---

### Task 1: Project scaffold and tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `.gitignore`, `.nvmrc`, `LICENSE`, `release-please-config.json`, `.release-please-manifest.json`, `.github/workflows/ci.yml`, `.github/workflows/release-please.yml`, `src/constants.ts`, `src/index.ts`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Produces: `LIBREDESK_TARGET_VERSION`, `ENV` (object of env var names: `URL`, `API_KEY`, `API_SECRET`, `PROFILE`, `TOOLSETS`, `CONFIG_DIR`), `DEFAULT_CONFIG_DIR_NAME = ".libredesk-mcp"`, `IMPLICIT_ENV_PROFILE = "env"`, `HTTP_TIMEOUT_MS = 30_000`, `PACKAGE_NAME = "@spaceparrots/libredesk-mcp"`, `BIN_NAME = "ldesk"` from `src/constants.ts`.

- [ ] **Step 1: Initialise the repo**

Run `git init -b main` in `D:\SpaceParrots\libredesk-mcp`. The spec and this plan are already in `docs/superpowers/`; they get committed (unlike vex, do not gitignore `docs/superpowers/`).

- [ ] **Step 2: Copy and adapt tooling from vex**

Copy `tsconfig.json`, `eslint.config.js`, `release-please-config.json` and both workflows from `D:\Tools\vex`. Changes: CI matrix `[22, 24]` and lint job on 22; `.nvmrc` `22`; `.release-please-manifest.json` `{ ".": "0.0.0" }`; `.gitignore` from vex without the `/docs/superpowers/` and `.vendure-vex/` lines, plus `.libredesk-mcp/` and `dev/data/`. `LICENSE` MIT, `Copyright (c) 2026 SpaceParrots`. `vitest.config.ts`: `include: ["tests/**/*.test.ts"]`, `exclude: ["tests/live/**"]`, coverage v8 over `src/**` excluding `src/index.ts`, thresholds 80 for lines/functions/branches/statements.

`package.json`: name, `"bin": { "ldesk": "dist/index.js" }`, `"files": ["dist", "README.md", "LICENSE"]`, repository `git+https://github.com/SpaceParrots/libredesk-mcp.git`, keywords `libredesk, helpdesk, mcp, cli, knowledge-base, claude`, scripts `build` (`tsc`), `dev` (`tsx src/index.ts`), `lint` (`eslint src/ tests/`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `test:coverage`, `test:live` (`vitest run --config vitest.live.config.ts`), `verify` (`npm run lint && npm run typecheck && npm test`). Install the runtime dependencies from Global Constraints at their current majors, and dev dependencies `typescript@^5` (not 7), `tsx`, `vitest`, `@vitest/coverage-v8`, `eslint`, `typescript-eslint`, `eslint-plugin-unicorn`, `@types/node@^22`, `@types/turndown`.

- [ ] **Step 3: Write the smoke test**

```ts
// tests/smoke.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LIBREDESK_TARGET_VERSION } from "../src/constants.js";

describe("smoke", () => {
  it("pins the target LibreDesk version", () => {
    expect(LIBREDESK_TARGET_VERSION).toBe("2.9.2");
  });
  it("MCP SDK accepts a zod 4 shape", () => {
    const server = new McpServer({ name: "t", version: "0.0.0" });
    expect(() =>
      server.registerTool("t", { description: "d", inputSchema: { a: z.string().describe("x") } }, async () => ({ content: [] })),
    ).not.toThrow();
  });
});
```

- [ ] **Step 4: Run it, see it fail** (`npx vitest run tests/smoke.test.ts`, fails: cannot find `src/constants.js`).

- [ ] **Step 5: Write `src/constants.ts` and a stub `src/index.ts`** (`#!/usr/bin/env node`, prints `ldesk <version>` read from package.json via `createRequire`). If the zod 4 test fails, the installed SDK does not accept zod 4: upgrade the SDK, or fall back to `zod@^3` and note it in the commit.

- [ ] **Step 6: Run `npm run verify` and `npm run build`**, both pass.

- [ ] **Step 7: Commit** `chore: scaffold project with tooling from vex`

---

### Task 2: Errors, guards and secret masking

**Files:**
- Create: `src/errors.ts`, `src/guards.ts`, `src/mask.ts`
- Test: `tests/errors.test.ts`, `tests/mask.test.ts`

**Interfaces:**
- Produces from `src/errors.ts`:
  - `class LibreDeskError extends Error { readonly code: string; readonly hint?: string }` constructed as `new LibreDeskError(message, { code, hint, cause })`.
  - Subclasses with fixed codes: `ConfigError` (`CONFIG`), `NoProfileError` (`NO_PROFILE`), `ProfileNotFoundError` (`PROFILE_NOT_FOUND`), `NetworkError` (`NETWORK`), `ApiError` (`API`, adds `readonly status: number; readonly errorType?: string; readonly data?: unknown`), `AuthError extends ApiError` (`AUTH`, 401), `PermissionError extends ApiError` (`PERMISSION`, 403, adds `readonly permission?: string`), `NotFoundError extends ApiError` (`NOT_FOUND`, 404), `InputError` (`INPUT`, adds `readonly fields: readonly string[]`), `ConfirmationRequiredError` (`CONFIRMATION_REQUIRED`), `CancelledError` (`CANCELLED`).
  - `toLibreDeskError(err: unknown): LibreDeskError` (passes through LibreDeskError; wraps Error and strings as `LibreDeskError` with code `UNKNOWN`; wraps errno `ENOTFOUND`/`ECONNREFUSED`/`ETIMEDOUT` as `NetworkError`).
- Produces from `src/guards.ts`: `isRecord(value: unknown): value is Record<string, unknown>`.
- Produces from `src/mask.ts`: `SECRET_KEYS: readonly string[]`, `maskValue(value: string): string`, `maskSecrets<T>(value: T): T`, `redactText(text: string, secrets: readonly string[]): string`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/mask.test.ts
it("masks secret keys at any depth and leaves others", () => {
  const out = maskSecrets({ name: "a", api_secret: "abcdefgh1234", nested: { password: "pw", list: [{ token: "t0k3nvalue" }] } });
  expect(out).toEqual({ name: "a", api_secret: "••••1234", nested: { password: "••••", list: [{ token: "••••alue" }] } });
});
it("masks every value inside a headers object", () => {
  expect(maskSecrets({ headers: { "X-Api-Key": "supersecret", Accept: "json" } }))
    .toEqual({ headers: { "X-Api-Key": "••••cret", Accept: "••••" } });
});
it("does not mutate its input", () => {
  const input = { api_key: "abcdefgh" }; maskSecrets(input); expect(input.api_key).toBe("abcdefgh");
});
it("redacts known secrets from free text", () => {
  expect(redactText("token k:s3cr3tvalue failed", ["s3cr3tvalue"])).toBe("token k:•••• failed");
});
```

`SECRET_KEYS` = `api_key, api_secret, apiKey, apiSecret, secret, client_secret, password, token, access_token, refresh_token, authorization` (matched case-insensitively). `maskValue` keeps the last 4 characters only when the value is 8 or more characters long, otherwise returns `••••`.

```ts
// tests/errors.test.ts
it("keeps LibreDeskError instances", () => { const e = new NotFoundError("x", { status: 404 }); expect(toLibreDeskError(e)).toBe(e); });
it("maps ECONNREFUSED to NetworkError with a hint", () => {
  const err = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
  const out = toLibreDeskError(err); expect(out).toBeInstanceOf(NetworkError); expect(out.hint).toMatch(/URL/);
});
it("wraps unknown values", () => { expect(toLibreDeskError("boom").code).toBe("UNKNOWN"); });
```

- [ ] **Step 2: Run, see them fail.** `npx vitest run tests/mask.test.ts tests/errors.test.ts`
- [ ] **Step 3: Implement the three files.**
- [ ] **Step 4: Run, see them pass.**
- [ ] **Step 5: `npm run verify`, commit** `feat: add error types and secret masking`

---

### Task 3: Profile store and resolution

**Files:**
- Create: `src/config.ts`, `src/context.ts`
- Test: `tests/config.test.ts`, `tests/context.test.ts`

**Interfaces:**
- Consumes: errors from Task 2, constants from Task 1.
- Produces from `src/config.ts`:
  - `interface Profile { readonly name: string; readonly url: string; readonly apiKey: string; readonly apiSecret: string }`
  - `interface StoredProfile { readonly url: string; readonly apiKey: string; readonly apiSecret: string }`
  - `interface LibreDeskConfig { readonly activeProfile: string | null; readonly profiles: Readonly<Record<string, StoredProfile>>; readonly projects: Readonly<Record<string, string>> }`
  - `EMPTY_CONFIG: LibreDeskConfig`
  - `getConfigDir(env?: NodeJS.ProcessEnv): string`, `getConfigPath(env?): string`
  - `loadConfig(env?): Promise<LibreDeskConfig>` (missing file returns `EMPTY_CONFIG`; invalid JSON throws `ConfigError` with a hint naming the path)
  - `saveConfig(config, env?): Promise<void>` (mkdir recursive, write `config.json.tmp` with mode `0o600`, rename)
  - Pure transforms: `upsertProfile(config, profile: Profile): LibreDeskConfig` (first profile becomes active), `removeProfile(config, name)` (clears active and drops project links pointing at it), `useProfile(config, name)`, `linkProject(config, dir, name)`, `unlinkProject(config, dir)`. Unknown names throw `ProfileNotFoundError` listing the known names.
  - `normalizeUrl(url: string): string` (trims, removes trailing slashes, rejects non-http(s) with `ConfigError`)
  - `normalizeProjectPath(p: string): string` (resolve, forward slashes, lower-case drive letter on Windows, no trailing slash)
  - `assertValidProfileName(name: string): void` (`^[a-z0-9][a-z0-9-_]{0,62}$`)
- Produces from `src/context.ts`:
  - `type ProfileSource = "param" | "env" | "LIBREDESK_PROFILE" | "project" | "active"`
  - `interface ResolvedProfile { readonly profile: Profile; readonly source: ProfileSource }`
  - `resolveProfile(opts?: { override?: string; env?: NodeJS.ProcessEnv; cwd?: string; config?: LibreDeskConfig }): Promise<ResolvedProfile>`
  - `withProfile<T>(name: string | undefined, fn: () => Promise<T>): Promise<T>` (AsyncLocalStorage, as vex's `withEnv`)
  - `getCurrentProfile(): Promise<ResolvedProfile>` (uses the `withProfile` override if set)

- [ ] **Step 1: Write the failing tests.** Each test sets `LIBREDESK_CONFIG_DIR` to a fresh `mkdtemp` dir.

```ts
// tests/context.test.ts (resolution order)
const stored = upsertProfile(upsertProfile(EMPTY_CONFIG, p("prod")), p("staging"));
const envAll = { LIBREDESK_URL: "https://env.example", LIBREDESK_API_KEY: "k", LIBREDESK_API_SECRET: "s" };
it("explicit override wins over everything", async () => {
  const r = await resolveProfile({ override: "staging", env: { ...envAll, LIBREDESK_PROFILE: "prod" }, config: stored });
  expect(r).toMatchObject({ source: "param", profile: { name: "staging" } });
});
it("complete env vars beat LIBREDESK_PROFILE", async () => {
  const r = await resolveProfile({ env: { ...envAll, LIBREDESK_PROFILE: "prod" }, config: stored });
  expect(r).toMatchObject({ source: "env", profile: { name: "env", url: "https://env.example" } });
});
it("partial env vars fail naming the missing ones", async () => {
  await expect(resolveProfile({ env: { LIBREDESK_URL: "https://x", LIBREDESK_API_KEY: "k" }, config: stored }))
    .rejects.toThrow(/LIBREDESK_API_SECRET/);
});
it("LIBREDESK_PROFILE beats project link", async () => { /* source "LIBREDESK_PROFILE" */ });
it("project link matches a subdirectory of the linked dir", async () => {
  const cfg = linkProject(stored, "D:/Work/site", "staging");
  const r = await resolveProfile({ env: {}, cwd: "d:\\Work\\site\\packages\\web", config: cfg });
  expect(r).toMatchObject({ source: "project", profile: { name: "staging" } });
});
it("falls back to the active profile", async () => { /* source "active", name "prod" */ });
it("no profile at all throws NoProfileError with a hint to run ldesk login", async () => {
  await expect(resolveProfile({ env: {}, config: EMPTY_CONFIG })).rejects.toThrow(/ldesk login/);
});
it("withProfile overrides getCurrentProfile inside the callback only", async () => { /* ... */ });
```

```ts
// tests/config.test.ts
it("normalizes trailing slashes and keeps path prefixes", () => {
  expect(normalizeUrl(" https://example.com/helpdesk/ ")).toBe("https://example.com/helpdesk");
});
it("rejects non-http urls", () => { expect(() => normalizeUrl("ftp://x")).toThrow(ConfigError); });
it("first profile becomes active, second does not", () => { /* ... */ });
it("removing the active profile clears active and its project links", () => { /* ... */ });
it("save then load round-trips and writes mode 0600 on POSIX", async () => { /* skip mode check on win32 */ });
it("invalid JSON throws ConfigError naming the file", async () => { /* ... */ });
```

- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement `src/config.ts` and `src/context.ts`.** Port the structure of vex `src/config.ts` and `src/context.ts`, replacing environments with profiles. Project-link matching picks the longest linked path that is a prefix of the normalized cwd.
- [ ] **Step 4: Run, see them pass.**
- [ ] **Step 5: `npm run verify`, commit** `feat: add profile store and resolution`

---

### Task 4: HTTP client

**Files:**
- Create: `src/http.ts`
- Test: `tests/http.test.ts`

**Interfaces:**
- Consumes: `Profile` (Task 3), errors and `redactText` (Task 2), `HTTP_TIMEOUT_MS` (Task 1).
- Produces:
  - `type HttpMethod = "GET" | "POST" | "PUT" | "DELETE"`
  - `type QueryValue = string | number | boolean | undefined`
  - `interface RequestOptions { readonly query?: Readonly<Record<string, QueryValue>>; readonly body?: unknown; readonly fetchImpl?: typeof fetch; readonly timeoutMs?: number }`
  - `buildUrl(baseUrl: string, path: string, query?: Readonly<Record<string, QueryValue>>): string` (joins without dropping a base path prefix; skips undefined query values)
  - `authHeader(profile: Profile): string` returns `token <apiKey>:<apiSecret>`
  - `request<T = unknown>(profile: Profile, method: HttpMethod, path: string, opts?: RequestOptions): Promise<T>`

LibreDesk responses: success `{"status":"success","data":...}`, error `{"status":"error","message":"...","error_type":"InputException|PermissionException|NotFoundException|...","data":...}` (see `ErrorResponse` in the OpenAPI spec and `sendErrorEnvelope` in `cmd/handlers.go`).

- [ ] **Step 1: Write the failing tests** with a fake `fetchImpl` that records the request and returns a canned `Response`.

```ts
it("joins base path prefixes", () => {
  expect(buildUrl("https://ex.com/helpdesk", "/api/v1/tags", { a: 1, b: undefined })).toBe("https://ex.com/helpdesk/api/v1/tags?a=1");
});
it("sends token auth and JSON body, unwraps data", async () => {
  const { fetchImpl, calls } = fakeFetch(200, { status: "success", data: { id: 7 } });
  await expect(request(profile, "POST", "/api/v1/x", { body: { a: 1 }, fetchImpl })).resolves.toEqual({ id: 7 });
  expect(calls[0].headers.get("Authorization")).toBe("token key:secret");
  expect(calls[0].headers.get("Content-Type")).toBe("application/json");
  expect(calls[0].body).toBe('{"a":1}');
});
it("maps 401 to AuthError with a login hint", async () => { /* hint matches /ldesk login/ */ });
it("maps 403 to PermissionError carrying the server message", async () => { /* ... */ });
it("maps 404 to NotFoundError", async () => { /* ... */ });
it("maps 400 InputException to ApiError with errorType and message", async () => { /* ... */ });
it("handles a non-JSON 502 body", async () => {
  const { fetchImpl } = fakeFetch(502, "<html>Bad Gateway</html>", "text/html");
  await expect(request(profile, "GET", "/api/v1/x", { fetchImpl })).rejects.toThrow(/502/);
});
it("never puts the secret into an error message", async () => {
  const { fetchImpl } = fakeFetch(500, { status: "error", message: "bad token key:secret" });
  await expect(request(profile, "GET", "/x", { fetchImpl })).rejects.toSatisfy((e: Error) => !e.message.includes("secret"));
});
it("times out with NetworkError naming the URL", async () => { /* fetchImpl that waits for abort; timeoutMs: 10 */ });
it("returns text for non-JSON 200 responses", async () => { /* e.g. transcript endpoints */ });
```

- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement `src/http.ts`.** Use `AbortSignal.timeout`. Read the body as text first, then `JSON.parse` only when the content type is JSON. Pass every error message through `redactText(message, [profile.apiSecret])`.
- [ ] **Step 4: Run, see them pass.**
- [ ] **Step 5: `npm run verify`, commit** `feat: add LibreDesk HTTP client`

---

### Task 5: Local LibreDesk and live test harness

**Files:**
- Create: `docker-compose.dev.yml`, `dev/config.toml`, `dev/bootstrap.mjs`, `vitest.live.config.ts`, `tests/live/helpers.ts`, `tests/live/http.live.test.ts`
- Modify: `package.json` (scripts `dev:up`, `dev:down`, `dev:bootstrap`)

**Interfaces:**
- Consumes: `request`, `Profile` (Tasks 3, 4).
- Produces from `tests/live/helpers.ts`: `liveProfile(): Profile | undefined` (from the three env vars), `describeLive` (`describe.skipIf(!liveProfile())`), `writesAllowed(): boolean` (false when `LIBREDESK_LIVE_SCOPE=readonly`), `uniqueName(prefix: string): string` (`ldesk-live-<prefix>-<timestamp>`).

- [ ] **Step 1: Write `docker-compose.dev.yml`** from the upstream `docker-compose.yml` (in the LibreDesk clone) with these changes: image `libredesk/libredesk:v2.9.2`; app port `127.0.0.1:${LD_PORT:-9000}:9000`; Postgres and Redis not published to the host; `LIBREDESK_SYSTEM_USER_PASSWORD: ${LIBREDESK_SYSTEM_USER_PASSWORD:-ldesk-dev-Password1}`; uploads volume `./dev/data/uploads`; config mounted from `./dev/config.toml`; compose project name `ldesk-dev`. No pgvector needed (embeddings are stored as `BYTEA`).

- [ ] **Step 2: Write `dev/config.toml`** from upstream `config.sample.toml`: `[db] host = "db"`, `[redis] address = "redis:6379"`, a fixed 32-character dev-only `encryption_key` with a comment saying it is for local development only.

- [ ] **Step 3: Write `dev/bootstrap.mjs`** (plain Node, no dependencies): wait for `GET /health` to return 200 (timeout 120 s), `POST /api/v1/auth/login` with `{ email: "System", password }` (check the login request fields in `cmd/login.go`), keep the session cookie, set your own `csrf_token` cookie and the same value in `X-CSRFTOKEN` (the server only checks they match, `cmd/middlewares.go`), create an agent `ldesk-dev@example.com` with the Admin role via `POST /api/v1/agents` (body per OpenAPI `Create Agent`), `POST /api/v1/agents/{id}/api-key`, then print the three `LIBREDESK_*` lines and an `ldesk login` hint. Running it twice must not fail: if the agent exists, reuse it and regenerate the key.

- [ ] **Step 4: Start it and bootstrap**

Run: `npm run dev:up` (`docker compose -f docker-compose.dev.yml -p ldesk-dev up -d`), then `npm run dev:bootstrap`.
Expected: three `LIBREDESK_*=` lines. Save them to `.env.live` (gitignored by `.env.*`).

- [ ] **Step 5: Write the live test and config.** `vitest.live.config.ts` includes `tests/live/**/*.live.test.ts`, `testTimeout: 60000`, `fileParallelism: false`.

```ts
// tests/live/http.live.test.ts
describeLive("http against local LibreDesk", () => {
  it("GET /api/v1/agents/me returns the bootstrap agent", async () => {
    const me = await request<{ email: string }>(liveProfile()!, "GET", "/api/v1/agents/me");
    expect(me.email).toBe("ldesk-dev@example.com");
  });
  it("a wrong secret gives AuthError", async () => { /* ... */ });
});
```

- [ ] **Step 6: Run** `npm run test:live` with the `.env.live` values exported. Expected: 2 passed. Without them: all skipped, exit 0.

- [ ] **Step 7: Commit** `build: add local LibreDesk dev stack and live test harness`

---

### Task 6: Operation core

**Files:**
- Create: `src/ops/define.ts`, `src/ops/fields.ts`, `src/ops/run.ts`, `src/ops/catalog.ts`, `src/ops/merge.ts`
- Test: `tests/ops/define.test.ts`, `tests/ops/fields.test.ts`, `tests/ops/run.test.ts`, `tests/ops/catalog.test.ts`, `tests/ops/merge.test.ts`

**Interfaces:**
- Consumes: `request`, `HttpMethod`, `RequestOptions` (Task 4), `getCurrentProfile`, `Profile` (Task 3), errors (Task 2).
- Produces from `src/ops/define.ts`:

```ts
export type Impact = "read" | "write" | "caution" | "destructive";
export type Toolset = "knowledge" | "ai" | "workflow" | "support" | "core";
export interface OperationContext {
  readonly profile: Profile;
  readonly call: <T = unknown>(method: HttpMethod, path: string, opts?: Omit<RequestOptions, "fetchImpl">) => Promise<T>;
}
export interface Operation<S extends z.ZodRawShape = z.ZodRawShape> {
  readonly name: string;                 // snake_case, unique per domain; MCP action name
  readonly group?: string;               // CLI sub-group; name must start with `${group}_`
  readonly summary: string;              // one line, shown in --help, MCP action list, catalog
  readonly method: HttpMethod;
  readonly path: string;                 // "/api/v1/help-centers/{id}"; every {param} must be a key of input
  readonly input: S;
  readonly query?: readonly (keyof S & string)[];
  readonly impact: Impact;
  readonly effect?: string;              // required when impact is caution or destructive
  readonly permission?: string;          // e.g. "help_center:manage", added to PermissionError hints
  readonly undocumented?: boolean;
  readonly positional?: readonly (keyof S & string)[];
  readonly mcp?: boolean;                // default true
  readonly run?: (input: z.infer<z.ZodObject<S>>, ctx: OperationContext) => Promise<unknown>;
  readonly present?: (data: unknown, input: z.infer<z.ZodObject<S>>) => unknown;
}
export interface Domain {
  readonly name: string;                 // CLI command, kebab-case
  readonly tool: string;                 // MCP tool name, libredesk_*
  readonly toolset: Toolset;
  readonly summary: string;
  readonly operations: readonly Operation[];
}
export function defineOperation<S extends z.ZodRawShape>(op: Operation<S>): Operation<S>;
export function defineDomain(domain: Domain): Domain;
```

`defineOperation` throws at module load when a path param is not an input key, a `positional` or `query` entry is not an input key, `effect` is missing for `caution`/`destructive`, or `name` does not start with `${group}_`. `defineDomain` throws on duplicate operation names.

- Produces from `src/ops/fields.ts`:
  - `type FieldKind = "string" | "number" | "boolean" | "enum" | "json"`
  - `interface FieldInfo { readonly name: string; readonly kind: FieldKind; readonly required: boolean; readonly description: string; readonly enumValues?: readonly string[]; readonly defaultValue?: unknown; readonly array: boolean }`
  - `fieldInfo(name: string, schema: z.ZodType): FieldInfo` (unwraps optional/default/nullable; objects, records and arrays of non-strings are `json`; `z.array(z.string())` is `string` with `array: true`)
  - `operationFields(op: Operation): FieldInfo[]`
- Produces from `src/ops/run.ts`:
  - `splitInput(op: Operation, input: Record<string, unknown>): { path: string; query: Record<string, QueryValue>; body: Record<string, unknown> | undefined }` (path params URL-encoded; body is undefined for GET and DELETE, and when empty for other methods)
  - `validateInput(op: Operation, raw: unknown): Record<string, unknown>` (strict zod object; throws `InputError` whose `fields` lists the offending field names and whose message lists each zod issue)
  - `runOperation(op: Operation, raw: unknown, deps?: { profile?: Profile; fetchImpl?: typeof fetch }): Promise<unknown>` (validate, resolve profile, `op.run` or the default `request`, then `op.present`; a `PermissionError` gets `op.permission` added to its hint)
- Produces from `src/ops/catalog.ts`:
  - `interface CatalogEntry { readonly domain: string; readonly tool: string; readonly action: string; readonly method: HttpMethod; readonly path: string; readonly summary: string; readonly impact: Impact; readonly undocumented: boolean; readonly fields: readonly FieldInfo[] }`
  - `buildCatalog(domains: readonly Domain[], filter?: string): CatalogEntry[]` (filter matches domain name or tool name)
- Produces from `src/ops/merge.ts`:
  - `mergeForUpdate<T extends Record<string, unknown>>(current: T, changes: Record<string, unknown>, allowed: readonly (keyof T & string)[]): Partial<T>` (returns a new object with only `allowed` keys, taking `changes[k]` when it is not `undefined`, else `current[k]`)

- [ ] **Step 1: Write the failing tests.**

```ts
// tests/ops/define.test.ts
it("rejects a path param missing from input", () => {
  expect(() => defineOperation({ name: "get", summary: "s", method: "GET", path: "/x/{id}", input: {}, impact: "read" })).toThrow(/id/);
});
it("requires an effect for destructive operations", () => { /* ... */ });
it("requires grouped names to carry the group prefix", () => { /* group "collection", name "create" throws */ });
it("defineDomain rejects duplicate names", () => { /* ... */ });

// tests/ops/run.test.ts
const op = defineOperation({
  name: "collection_update", group: "collection", summary: "s", method: "PUT",
  path: "/api/v1/help-centers/{help_center_id}/collections/{id}",
  input: { help_center_id: z.number(), id: z.number(), name: z.string().optional(), locale: z.string().optional() },
  query: ["locale"], impact: "write",
});
it("splits path, query and body", () => {
  expect(splitInput(op, { help_center_id: 1, id: 2, name: "FAQ", locale: "de" }))
    .toEqual({ path: "/api/v1/help-centers/1/collections/2", query: { locale: "de" }, body: { name: "FAQ" } });
});
it("url-encodes path params", () => { /* id "a/b" -> "a%2Fb" */ });
it("rejects unknown fields and names them", () => {
  expect(() => validateInput(op, { help_center_id: 1, id: 2, nmae: "x" })).toThrow(InputError);
});
it("uses op.run when present and passes a ctx bound to the profile", async () => { /* ... */ });
it("applies present to the result", async () => { /* ... */ });
it("adds the permission name to a PermissionError hint", async () => { /* fake fetch 403; hint matches /help_center:manage/ */ });

// tests/ops/fields.test.ts
it("describes optional enums with defaults", () => {
  expect(fieldInfo("status", z.enum(["draft", "published"]).default("draft").describe("d")))
    .toMatchObject({ kind: "enum", required: false, enumValues: ["draft", "published"], defaultValue: "draft", description: "d" });
});
it("treats records and objects as json", () => { /* ... */ });
it("treats string arrays as repeatable strings", () => { /* array: true */ });

// tests/ops/merge.test.ts
it("keeps current values for keys not in changes", () => {
  expect(mergeForUpdate({ title: "a", ai_enabled: true, views: 9 }, { title: "b" }, ["title", "ai_enabled"]))
    .toEqual({ title: "b", ai_enabled: true });
});
it("lets an explicit false override true", () => { /* ai_enabled: false wins */ });
```

- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement the five files.**
- [ ] **Step 4: Run, see them pass.**
- [ ] **Step 5: `npm run verify`, commit** `feat: add operation definitions and runner`

---

### Task 7: Markdown content for articles

**Files:**
- Create: `src/content/markdown.ts`, `tests/fixtures/articles/{simple,code,table,youtube,styled,image-attrs}.html`
- Test: `tests/content/markdown.test.ts`

**Interfaces:**
- Produces:
  - `type ContentFormat = "markdown" | "html"`
  - `markdownToHtml(markdown: string): string` (marked, GFM on, synchronous)
  - `htmlToMarkdown(html: string): string` (turndown, `headingStyle: "atx"`, `codeBlockStyle: "fenced"`, `bulletListMarker: "-"`)
  - `isMarkdownSafe(html: string): boolean`
  - `toArticleHtml(content: string, format: ContentFormat): string`
  - `readArticleContent(html: string, format: ContentFormat): { readonly content: string; readonly content_format: ContentFormat; readonly note?: string }`

Design change from the spec, on purpose: instead of comparing a markdown round trip (which flags almost every editor-produced article because marked and the LibreDesk editor format HTML differently), `isMarkdownSafe` checks the HTML against an allow-list. It is safe only when every element is one of `p, h1-h6, strong, b, em, i, a, ul, ol, li, blockquote, code, pre, br, hr, img, s, del` and the only attributes are `a[href|title|target|rel]`, `img[src|alt|title]`, `ol[start]` and `code[class^="language-"]`. Anything else (tables, iframes, embeds, `style`, `class`, `data-*`, `span`, `div`, `u`) means HTML is returned, with `note: "Returned as HTML because it contains <tag> which markdown cannot represent. Edit and send it back with format \"html\"."`. Parse with `node-html-parser`.

Get the real editor output for fixtures from the local instance (Task 5): create one article through the LibreDesk UI with a table, a YouTube embed and an image, then fetch it with `GET /api/v1/collections/0/articles/{id}`. If that is not practical, write the fixtures by hand from the tiptap extensions in `frontend/apps/main/src/components/editor/ArticleEditor.vue`.

- [ ] **Step 1: Write the failing tests.**

```ts
it("simple and code fixtures are markdown-safe", () => { expect(isMarkdownSafe(fixture("simple"))).toBe(true); expect(isMarkdownSafe(fixture("code"))).toBe(true); });
it.each(["table", "youtube", "styled", "image-attrs"])("%s fixture is not markdown-safe", (name) => { expect(isMarkdownSafe(fixture(name))).toBe(false); });
it("readArticleContent returns markdown for safe html", () => {
  expect(readArticleContent("<h2>Refunds</h2><p>Within <strong>30</strong> days.</p>", "markdown"))
    .toEqual({ content: "## Refunds\n\nWithin **30** days.", content_format: "markdown" });
});
it("readArticleContent falls back to html and explains why", () => {
  const out = readArticleContent(fixture("table"), "markdown");
  expect(out.content_format).toBe("html"); expect(out.note).toMatch(/<table>/);
});
it("readArticleContent with html returns the input untouched", () => { /* ... */ });
it("toArticleHtml converts markdown and passes html through", () => {
  expect(toArticleHtml("# Hi", "markdown")).toBe("<h1>Hi</h1>\n"); expect(toArticleHtml("<p>x</p>", "html")).toBe("<p>x</p>");
});
it("markdown -> html -> markdown is stable for the simple fixture's markdown", () => { /* ... */ });
```

- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement `src/content/markdown.ts`.**
- [ ] **Step 4: Run, see them pass.**
- [ ] **Step 5: `npm run verify`, commit** `feat: add markdown conversion for article content`

---

### Task 8: Help center domain

**Files:**
- Create: `src/domains/help-center.ts`, `src/domains/index.ts`
- Test: `tests/domains/help-center.test.ts`, `tests/live/help-center.live.test.ts`

**Interfaces:**
- Consumes: `defineOperation`, `defineDomain`, `mergeForUpdate` (Task 6).
- Produces: `helpCenterDomain: Domain` (`name: "help-center"`, `tool: "libredesk_help_center"`, `toolset: "knowledge"`); `DOMAINS: readonly Domain[]` in `src/domains/index.ts` (later tasks append).

All operations are `undocumented: true`, `permission: "help_center:manage"`. Field names follow LibreDesk's JSON (snake_case). Every field gets a `.describe()` written for a model choosing values.

| name | group | method, path | input (required in bold) | impact, effect |
| - | - | - | - | - |
| `list` | | GET `/api/v1/help-centers` | none | read |
| `get` | | GET `/api/v1/help-centers/{id}` | **id** | read |
| `locales` | | GET `/api/v1/help-centers/locales` | none | read |
| `tree` | | GET `/api/v1/help-centers/{id}/tree` | **id**, locale (query) | read |
| `insights` | | GET `/api/v1/help-centers/{id}/insights` | **id** | read |
| `create` | | POST `/api/v1/help-centers` | **name, slug, page_title**, meta_description, default_locale, allowed_locales (string[]), theme (object), custom_domain, template, custom_css, custom_js, livechat_inbox_id (number or null) | write |
| `update` | | PUT `/api/v1/help-centers/{id}` | **id**, all `create` fields optional | write |
| `toggle` | | PUT `/api/v1/help-centers/{id}/toggle` | **id** | caution, "Takes the public help center online or offline." |
| `delete` | | DELETE `/api/v1/help-centers/{id}` | **id** | destructive, "Deletes the help center with all its collections and articles." |
| `collection_list` | collection | GET `/api/v1/help-centers/{help_center_id}/collections` | **help_center_id** | read |
| `collection_create` | collection | POST `/api/v1/help-centers/{help_center_id}/collections` | **help_center_id, name**, slug, parent_id (number or null), locale, description, icon (lucide icon name), sort_order, is_published (default false) | write |
| `collection_update` | collection | PUT `/api/v1/help-centers/{help_center_id}/collections/{id}` | **help_center_id, id**, all `collection_create` fields optional | write |
| `collection_toggle` | collection | PUT `/api/v1/collections/{id}/toggle` | **id** | caution, "Publishes or unpublishes the collection on the public help center." |
| `collection_reorder` | collection | PUT `/api/v1/help-centers/{help_center_id}/collection-sort-order` | **help_center_id, order** (record of collection id to sort order) | write |
| `collection_delete` | collection | DELETE `/api/v1/help-centers/{help_center_id}/collections/{id}` | **help_center_id, id** | destructive, "Deletes the collection and the articles in it." |

Custom `run` functions:
- `update`: GET the help center, `mergeForUpdate` over the `HelpCenterRequest` keys, PUT the merged object.
- `collection_update`: there is no single-collection GET; GET the collection list, find by `id` (throw `NotFoundError` when absent), merge over the `CollectionRequest` keys, PUT.
- `collection_reorder`: body is the `order` record itself, not `{ order }`.

`present` for `list` and `collection_list`: keep `id, name, slug, is_active/is_published, default_locale/locale, parent_id, updated_at`. `tree` keeps collection and article ids, titles, slugs, statuses and `ai_enabled`, and drops article `content`.

Before writing the schemas, read `HelpCenterRequest`, `CollectionRequest`, `validateHelpCenter` and `validateCollection` in the LibreDesk clone, and the `template` values accepted by `internal/helpcenter`, so required fields and enums match the server.

- [ ] **Step 1: Write the failing unit tests**, table-driven over the operations with a fake fetch:

```ts
it.each(cases)("%s sends %s %s", async (name, method, path, input, body) => { /* runOperation, assert method, url path, JSON body */ });
it("update keeps fields the caller did not pass", async () => {
  // fake GET returns { name: "Docs", slug: "docs", page_title: "Docs", theme: { color: "#000" }, default_locale: "en", allowed_locales: ["en","de"], custom_domain: "help.ex.com", is_active: true, id: 1 }
  // runOperation(update, { id: 1, page_title: "Help" }) -> PUT body has page_title "Help" and every other HelpCenterRequest field unchanged
});
it("collection_update merges from the collection list", async () => { /* ... */ });
it("collection_update on an unknown id throws NotFoundError", async () => { /* ... */ });
it("collection_reorder sends the order record as the body", async () => { /* body {"3":0,"5":1} */ });
it("list present drops theme and custom css/js", async () => { /* ... */ });
```

- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement `src/domains/help-center.ts` and `src/domains/index.ts`.**
- [ ] **Step 4: Run, see them pass.**
- [ ] **Step 5: Write and run the live test** (`writesAllowed()` only): create a help center with `uniqueName`, get, update `page_title` and check `allowed_locales` and `slug` survived, create two collections, reorder, toggle one, `collection_update` its description, read the tree, delete both collections, delete the help center. Fix any schema mismatch the server reports and add a unit test case for it.
- [ ] **Step 6: `npm run verify`, commit** `feat(help-center): add help center and collection operations`

---

### Task 9: Articles domain

**Files:**
- Create: `src/domains/articles.ts`
- Modify: `src/domains/index.ts`
- Test: `tests/domains/articles.test.ts`, `tests/live/articles.live.test.ts`

**Interfaces:**
- Consumes: Task 6 core, Task 7 `toArticleHtml`, `readArticleContent`, `ContentFormat`.
- Produces: `articlesDomain: Domain` (`name: "articles"`, `tool: "libredesk_articles"`, `toolset: "knowledge"`).

All `undocumented: true`, `permission: "help_center:manage"`. Status values are `draft` and `published` only (`isValidArticleStatus`).

| name | method, path | input (required in bold) | impact, effect |
| - | - | - | - |
| `list` | custom (tree) | **help_center_id**, locale, collection_id | read |
| `get` | GET `/api/v1/collections/{collection_id}/articles/{id}` | **id**, collection_id (default 0), format (`markdown`/`html`, default `markdown`) | read |
| `create` | POST `/api/v1/collections/{collection_id}/articles` | **collection_id, title, content**, format (default `markdown`), slug, locale, excerpt, meta_title, meta_description, meta_image_url, sort_order, status (default `draft`), ai_enabled (default `true`) | write |
| `update` | PUT `/api/v1/articles/{id}` | **id**, every `create` field except collection_id optional, format | write |
| `set_status` | PUT `/api/v1/articles/{id}/status` | **id, status** | caution, "Publishing makes the article public and available to AI assistants when ai_enabled is on." |
| `move` | PUT `/api/v1/articles/{id}/collection` | **id, collection_id** | write |
| `reorder` | PUT `/api/v1/collections/{collection_id}/article-sort-order` | **collection_id, order** (record of article id to sort order) | write |
| `linkable` | GET `/api/v1/help-centers/{help_center_id}/linkable-articles` | **help_center_id, exclude_locale** (query) | read |
| `link_translation` | PUT `/api/v1/articles/{id}/link-translation` | **id, translation_of_id** | write |
| `unlink_translation` | PUT `/api/v1/articles/{id}/unlink-translation` | **id** | write |
| `delete` | DELETE `/api/v1/collections/{collection_id}/articles/{id}` | **id**, collection_id | destructive, "Deletes the article. Linked translations stay." |

Notes:
- `handleGetArticle` reads only `id`; the collection segment is ignored, so `get` defaults `collection_id` to `0`. Confirm in the live test; if the server rejects `0`, make `get` resolve the collection from the tree instead.
- `ai_enabled` defaults to `true` (LibreDesk's own form defaults to `false`). Reason: this tool exists to feed the AI, and `status` still defaults to `draft`, so nothing reaches customers until it is published. Say both in the field descriptions.
- `create` and `update` convert `content` with `toArticleHtml(content, format)` in a custom `run`.
- `update` GETs the article, merges over the `ArticleRequest` keys except `collection_id` (moving is `move`), converts content only when `content` was passed, then PUTs. `update` has no `status` field: publishing always goes through `set_status`, so it always gets the `caution` confirmation. Passing `status` to `update` fails strict validation; the `update` summary says to use `set_status`.
- `get` returns the article with `content` and `content_format` from `readArticleContent`, plus `note` when it fell back, and keeps `translations`.
- `list` GETs the tree with `locale`, flattens articles with `collection_id`, `collection_name`, `id`, `title`, `slug`, `locale`, `status`, `ai_enabled`, `updated_at`, `view_count`, `helpful_count`, `not_helpful_count`; filters by `collection_id` when given; never returns `content`.
- `delete` without `collection_id` uses `0` the same way as `get`; confirm in the live test.

- [ ] **Step 1: Write the failing unit tests.**

```ts
it("create converts markdown and defaults draft + ai_enabled", async () => {
  // body: { title: "Refunds", content: "<h2>Policy</h2>\n", status: "draft", ai_enabled: true }
});
it("create with format html sends content untouched", async () => { /* ... */ });
it("update keeps fields the caller did not pass", async () => {
  // GET returns { id: 4, collection_id: 2, title: "Old", content: "<p>Body</p>", excerpt: "E", status: "published", ai_enabled: true, slug: "old", locale: "en", meta_title: "", meta_description: "", meta_image_url: "", sort_order: 3 }
  // runOperation(update, { id: 4, title: "New" }) -> PUT /api/v1/articles/4 body equals the GET values with title "New", no collection_id, content unchanged
});
it("update rejects a status field", async () => { /* InputError, fields ["status"] */ });
it("get returns markdown with content_format", async () => { /* ... */ });
it("get falls back to html for a table article", async () => { /* content_format "html", note present */ });
it("list flattens the tree, filters by collection and drops content", async () => { /* ... */ });
it("reorder sends the order record as body", async () => { /* ... */ });
```

- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement `src/domains/articles.ts`, add it to `DOMAINS`.**
- [ ] **Step 4: Run, see them pass.**
- [ ] **Step 5: Live test** (writes only): throwaway help center with two locales (`en`, `de`) and one collection per locale; create an article from markdown, get it as markdown, update the title and check `ai_enabled` and content survived, `set_status` published, `list` shows it, create a `de` article and `link_translation`, `linkable`, `unlink_translation`, `move`, `reorder`, delete both, delete the help center. Confirm the `collection_id = 0` behaviour of `get` and `delete`.
- [ ] **Step 6: `npm run verify`, commit** `feat(articles): add article operations with markdown content`

---

### Task 10: AI knowledge domain

**Files:**
- Create: `src/domains/ai-knowledge.ts`
- Modify: `src/domains/index.ts`
- Test: `tests/domains/ai-knowledge.test.ts`, `tests/live/ai-knowledge.live.test.ts`

**Interfaces:**
- Produces: `aiKnowledgeDomain: Domain` (`name: "knowledge"`, `tool: "libredesk_ai_knowledge"`, `toolset: "knowledge"`).

All `undocumented: true`, `permission: "ai:manage"`. Snippet `content` is plain text (the LibreDesk form is a textarea); no conversion.

| name | group | method, path | input (required in bold) | impact, effect |
| - | - | - | - | - |
| `snippet_list` | snippet | GET `/api/v1/ai/snippets` | enabled (boolean), search (string) | read |
| `snippet_get` | snippet | custom (list + find) | **id** | read |
| `snippet_create` | snippet | POST `/api/v1/ai/snippets` | **title, content**, enabled (default true) | write |
| `snippet_update` | snippet | PUT `/api/v1/ai/snippets/{id}` | **id**, title, content, enabled | write |
| `snippet_import_url` | snippet | POST `/api/v1/ai/snippets/import-url` | **url** | write |
| `snippet_delete` | snippet | DELETE `/api/v1/ai/snippets/{id}` | **id** | destructive, "Deletes the snippet. Assistants stop using it." |
| `faq_list` | faq | GET `/api/v1/ai/faq-suggestions` | status (query, enum from the `FAQSuggestion` status constants in `internal/aiagent`) | read |
| `faq_approve` | faq | POST `/api/v1/ai/faq-suggestions/{id}/approve` | **id**, question, answer | write |
| `faq_reject` | faq | POST `/api/v1/ai/faq-suggestions/{id}/reject` | **id** | write |
| `learning_get` | learning | GET `/api/v1/ai/faq-learning` | none | read |
| `learning_set` | learning | PUT `/api/v1/ai/faq-learning` | **enabled** | caution, "Mines resolved conversations with your AI provider, which costs money per conversation." |

Custom `run` functions:
- `snippet_list`: filter client-side by `enabled` and a case-insensitive `search` over title and content; `present` returns `id, title, enabled, source, source_url, updated_at` and `preview` (first 160 characters of content).
- `snippet_get`: list, find by id, `NotFoundError` when absent.
- `snippet_update`: list, find, merge over `title, content, enabled`, PUT (the handler requires all three; a missing `enabled` would disable it).
- `faq_approve`: when `question` or `answer` is missing, take it from the suggestion in `faq_list` (the handler stores whatever is sent).

- [ ] **Step 1: Write the failing unit tests.**

```ts
it("snippet_update keeps fields the caller did not pass", async () => {
  // list returns [{ id: 3, title: "Refunds", content: "Full policy", enabled: true }]
  // runOperation(snippet_update, { id: 3, title: "Refund policy" }) -> PUT body { title: "Refund policy", content: "Full policy", enabled: true }
});
it("snippet_list filters by search and enabled and trims content to a preview", async () => { /* ... */ });
it("snippet_create defaults enabled to true", async () => { /* ... */ });
it("faq_approve fills question and answer from the suggestion", async () => { /* ... */ });
it("learning_set sends { enabled }", async () => { /* ... */ });
```

- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement, add to `DOMAINS`.**
- [ ] **Step 4: Run, see them pass.**
- [ ] **Step 5: Live test** (writes only): create, list with search, get, update title and check content and enabled survived, delete; `learning_get`, `learning_set` to the opposite and back; `faq_list` returns an array. Without an AI provider configured locally, check whether snippet create still succeeds (embedding should be async); if the server rejects it, note it in the test and in the README. Skip `snippet_import_url` unless `LIBREDESK_LIVE_IMPORT_URL` is set.
- [ ] **Step 6: `npm run verify`, commit** `feat(knowledge): add AI snippet and FAQ suggestion operations`

---

### Task 11: Lookup domain

**Files:**
- Create: `src/domains/lookup.ts`
- Modify: `src/domains/index.ts`
- Test: `tests/domains/lookup.test.ts`, `tests/live/lookup.live.test.ts`

**Interfaces:**
- Produces: `lookupDomain: Domain` (`name: "lookup"`, `tool: "libredesk_lookup"`, `toolset: "core"`). All operations `impact: "read"`.

| name | method, path | input | undocumented |
| - | - | - | - |
| `me` | GET `/api/v1/agents/me` | none | no |
| `agents` | GET `/api/v1/agents/compact` | none | yes |
| `teams` | GET `/api/v1/teams/compact` | none | yes |
| `tags` | GET `/api/v1/tags` | none | no |
| `inboxes` | GET `/api/v1/inboxes` | none | no |
| `statuses` | GET `/api/v1/statuses` | none | no |
| `priorities` | GET `/api/v1/priorities` | none | no |
| `custom_attributes` | GET `/api/v1/custom-attributes` | the query params from the OpenAPI `List Custom Attributes` operation | no |

`present` keeps ids, names and the one or two fields needed to pick (email for agents, channel and enabled for inboxes).

- [ ] **Step 1: Failing unit tests** (table-driven paths, `present` shapes).
- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4: Run, pass.**
- [ ] **Step 5: Live test:** every lookup returns an array (or an object for `me`).
- [ ] **Step 6: `npm run verify`, commit** `feat(lookup): add read-only lookups`

---

### Task 12: CLI generator

**Files:**
- Create: `src/cli/prompt.ts`, `src/cli/output.ts`, `src/cli/flags.ts`, `src/cli/confirm.ts`, `src/cli/domain-commands.ts`
- Test: `tests/cli/flags.test.ts`, `tests/cli/confirm.test.ts`, `tests/cli/output.test.ts`, `tests/cli/domain-commands.test.ts`

**Interfaces:**
- Consumes: `Operation`, `Domain`, `operationFields`, `FieldInfo`, `runOperation`, `withProfile`, `maskSecrets`, errors.
- Produces from `src/cli/prompt.ts`:

```ts
export interface PromptAdapter {
  text(o: { message: string; placeholder?: string; initialValue?: string; validate?: (v: string) => string | undefined }): Promise<string>;
  password(o: { message: string }): Promise<string>;
  confirm(o: { message: string; initialValue?: boolean }): Promise<boolean>;
  select<T extends string>(o: { message: string; options: readonly { value: T; label: string; hint?: string }[] }): Promise<T>;
  note(message: string, title?: string): void;
}
export const clackPrompts: PromptAdapter;   // wraps @clack/prompts; a cancel throws CancelledError
```

- Produces from `src/cli/output.ts`: `printResult(data: unknown, opts: { json: boolean }): void` (always `maskSecrets` first; `json` prints `JSON.stringify(data, null, 2)`; an array of objects prints a table of its scalar columns, at most 6, plus a `n rows` line; an object prints `key: value` lines with nested values as compact JSON; a string prints as is), `printSuccess(msg)`, `printInfo(msg)`, `handleCliError(err: unknown): never` (prints message and `Hint:` line to stderr, exit code 1; `CancelledError` exits 130).
- Produces from `src/cli/flags.ts`:
  - `interface FlagSpec { readonly field: string; readonly flags: string; readonly description: string; readonly kind: FieldKind; readonly required: boolean; readonly choices?: readonly string[]; readonly array: boolean }`
  - `flagsFor(op: Operation): FlagSpec[]` (`collection_id` becomes `--collection-id <value>`; booleans `--ai-enabled` and `--no-ai-enabled`; arrays repeatable; positional fields are not flags)
  - `parseFlagValues(op: Operation, options: Record<string, unknown>, positionals: readonly string[], readFile?: (path: string) => string): Record<string, unknown>` (numbers parsed; `json` kind parses JSON; any string or json value starting with `@` is read from that file, `@@` escapes a literal `@`)
- Produces from `src/cli/confirm.ts`:
  - `collectMissing(op: Operation, values: Record<string, unknown>, deps: { isTTY: boolean; prompt: PromptAdapter }): Promise<Record<string, unknown>>` (non-TTY: throws `InputError` listing the missing flags in `--kebab` form; TTY: prompts per missing field, using enum selects and boolean confirms)
  - `confirmImpact(op: Operation, deps: { yes: boolean; isTTY: boolean; prompt: PromptAdapter }): Promise<void>` (no-op for read/write; for caution/destructive: `yes` passes; non-TTY throws `ConfirmationRequiredError` whose message is the `effect` and whose hint names `--yes`; TTY asks with the effect as message, default No, a No throws `CancelledError`)
- Produces from `src/cli/domain-commands.ts`:
  - `interface CliDeps { readonly isTTY: boolean; readonly prompt: PromptAdapter; readonly run: typeof runOperation; readonly print: typeof printResult }`
  - `addDomainCommands(program: Command, domains: readonly Domain[], deps: CliDeps): void` builds `ldesk <domain> [<group>] <op> [positionals] [flags]`. Ungrouped ops sit directly under the domain; grouped ops under `ldesk <domain> <group> <op>` where `<op>` is the name without the group prefix, in kebab-case (`collection_create` becomes `ldesk help-center collection create`). Every command gets `--json`, `--yes` and `--profile <name>`; help text shows the summary, then `[undocumented API]` when flagged, then the effect for caution/destructive.

- [ ] **Step 1: Write the failing tests.**

```ts
// tests/cli/flags.test.ts
it("derives kebab flags, negatable booleans and choices", () => { /* ... */ });
it("reads @file values and keeps @@ as a literal @", () => { /* readFile stub */ });
it("parses json fields and reports bad JSON with the flag name", () => { /* InputError fields ["theme"] */ });

// tests/cli/confirm.test.ts
it("non-TTY run without required fields fails naming the flags", async () => {
  await expect(collectMissing(createArticle, { collection_id: 1 }, { isTTY: false, prompt: neverPrompt }))
    .rejects.toThrow(/--title.*--content|--content.*--title/);
});
it("non-TTY destructive op without --yes fails with the effect and a --yes hint", async () => { /* ... */ });
it("TTY destructive op asks and a No cancels", async () => { /* fake prompt returns false -> CancelledError */ });
it("--yes skips the prompt", async () => { /* prompt not called */ });
it("read and write ops never prompt", async () => { /* ... */ });

// tests/cli/output.test.ts
it("masks secrets in table, object and json output", () => { /* capture stdout; no 'secretvalue' substring */ });
it("prints arrays as tables with at most 6 scalar columns", () => { /* ... */ });

// tests/cli/domain-commands.test.ts
it("builds nested commands and runs the operation with parsed values", async () => {
  // program.parseAsync(["node","ldesk","help-center","collection","create","--help-center-id","1","--name","FAQ"])
  // fake run receives (collection_create op, { help_center_id: 1, name: "FAQ" })
});
it("passes --profile through withProfile", async () => { /* ... */ });
it("positional args fill their fields", async () => { /* ldesk articles get 42 */ });
```

- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement the five files.** The command action order is: parse flag values, `collectMissing`, `confirmImpact`, `withProfile(profile, () => run(op, values))`, `print`. Errors go to `handleCliError`.
- [ ] **Step 4: Run, see them pass.**
- [ ] **Step 5: `npm run verify`, commit** `feat(cli): generate commands from operation definitions`

---

### Task 13: CLI program and built-in commands

**Files:**
- Create: `src/cli/program.ts`, `src/commands/login.ts`, `src/commands/profile.ts`, `src/commands/status.ts`, `src/commands/request.ts`, `src/commands/mcp.ts`, `src/services/auth.ts`, `src/services/status.ts`, `src/services/raw-request.ts`, `src/services/mcp-config.ts`
- Modify: `src/index.ts`
- Test: `tests/services/auth.test.ts`, `tests/services/status.test.ts`, `tests/services/raw-request.test.ts`, `tests/services/mcp-config.test.ts`, `tests/cli/program.test.ts`, `tests/index.test.ts`

**Interfaces:**
- Produces:
  - `verifyCredentials(input: { url: string; apiKey: string; apiSecret: string }, fetchImpl?: typeof fetch): Promise<{ id: number; email: string; first_name: string; last_name: string }>` (GET `/api/v1/agents/me`)
  - `interface StatusReport { readonly profile: string; readonly source: ProfileSource; readonly url: string; readonly apiKey: string /* masked */; readonly reachable: boolean; readonly agent?: string; readonly error?: string; readonly targetVersion: string; readonly configPath: string }` and `getStatus(deps?): Promise<StatusReport>` (never throws for an unreachable server; reports it)
  - `rawRequest(input: { method: HttpMethod; path: string; query?: Record<string, QueryValue>; body?: unknown; confirm?: boolean }, deps?): Promise<unknown>` (path must start with `/api/v1/` or `/health`; DELETE without `confirm: true` throws `ConfirmationRequiredError`)
  - `buildServerEntry(opts: { mode: "profile" | "env"; profileName?: string; profile?: Profile; useNpx: boolean; toolsets?: string }): { command: string; args: string[]; env: Record<string, string> }` (`useNpx`: `npx -y @spaceparrots/libredesk-mcp serve`, else `ldesk serve`; mode `profile` sets `LIBREDESK_PROFILE`; mode `env` sets the three credential vars; `toolsets` sets `LIBREDESK_TOOLSETS`)
  - `mergeMcpJson(existingText: string | undefined, serverName: string, entry): string` (port of vex `src/services/mcp-config.ts`, server name `libredesk`)
  - `createProgram(deps: CliDeps): Command`
  - `main(argv: readonly string[], deps?: { isTTY?: boolean }): Promise<void>` in `src/index.ts`

Built-in commands:
- `ldesk login [--url] [--api-key] [--api-secret] [--name]`: prompts for missing values (secret via `password`), `verifyCredentials`, `upsertProfile`, `saveConfig`, prints "Logged in to <url> as <agent>. Profile <name> is <active|saved>." Profile name defaults to the URL host with dots replaced by dashes. Non-TTY with missing values fails naming the flags.
- `ldesk profile list | use <name> | remove <name> | link [name] | unlink`: list marks the active one and the resolved one; `link` uses the cwd.
- `ldesk status [--json]`: prints the `StatusReport`.
- `ldesk request <method> <path> [--query key=value]... [--body <json|@file>] [--yes]`: TTY DELETE asks, non-TTY DELETE needs `--yes`.
- `ldesk catalog [domain] [--json]`: prints `buildCatalog(DOMAINS, domain)` as a table of tool, action, method, path, impact.
- `ldesk mcp install [--scope project|print] [--mode profile|env] [--npx] [--toolsets <list>]`: `project` merges into `./.mcp.json`; `print` prints the JSON snippet for Claude Desktop and other clients. With `--mode env` and `--scope project`, warn that `.mcp.json` now holds a secret and is often committed, and ask to confirm.
- `ldesk serve`: starts the MCP server (Task 15 provides `startMcpServer`; until then the command prints "not available yet" and the test is skipped).
- `ldesk` with no args: interactive mode when `isTTY`, else `serve` (Task 14 provides `runInteractive`).

- [ ] **Step 1: Write the failing tests.**

```ts
it("buildServerEntry with npx and profile mode", () => {
  expect(buildServerEntry({ mode: "profile", profileName: "prod", useNpx: true }))
    .toEqual({ command: "npx", args: ["-y", "@spaceparrots/libredesk-mcp", "serve"], env: { LIBREDESK_PROFILE: "prod" } });
});
it("mergeMcpJson keeps other servers and unknown keys", () => { /* ... */ });
it("getStatus reports an unreachable server without throwing and masks the key", async () => { /* ... */ });
it("rawRequest refuses DELETE without confirm", async () => { /* ... */ });
it("rawRequest rejects paths outside /api/v1", async () => { /* ... */ });
it("login saves a profile named after the host and makes the first one active", async () => { /* fake prompt + fetch, temp config dir */ });
it("login in non-TTY without --api-secret fails naming the flag", async () => { /* ... */ });
it("main with no args and no TTY starts serve", async () => { /* inject fakes */ });
```

- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.** `createProgram` registers built-ins, then `addDomainCommands(program, DOMAINS, deps)`.
- [ ] **Step 4: Run, see them pass.**
- [ ] **Step 5: Manual check against the local instance.** `npm run build`, then `node dist/index.js login --url http://localhost:9000 --api-key ... --api-secret ...`, `node dist/index.js status`, `node dist/index.js help-center list`, `node dist/index.js catalog knowledge`. Each prints sensible output; `status` shows the key masked.
- [ ] **Step 6: `npm run verify`, commit** `feat(cli): add login, profiles, status, request and mcp install`

---

### Task 14: Interactive mode

**Files:**
- Create: `src/cli/interactive.ts`
- Modify: `src/index.ts` (wire no-args TTY), `src/cli/program.ts` (add `ldesk i` alias)
- Test: `tests/cli/interactive.test.ts`

**Interfaces:**
- Consumes: `PromptAdapter`, `operationFields`, `collectMissing`, `confirmImpact`, `runOperation`, `printResult`, `DOMAINS`.
- Produces:
  - `runInteractive(domains: readonly Domain[], deps: CliDeps): Promise<void>`: select domain (label is the domain summary), select operation (label is the summary, hint is impact plus `undocumented`), prompt every field (required first, then "Set optional fields?" confirm), confirm impact, run, print, then show the equivalent command with `prompt.note(commandLineFor(...), "Run it again with")`, then ask "Do something else?".
  - `commandLineFor(domain: Domain, op: Operation, values: Record<string, unknown>): string`

- [ ] **Step 1: Write the failing tests.**

```ts
it("renders grouped ops with kebab flags and quoting", () => {
  expect(commandLineFor(helpCenterDomain, collectionCreate, { help_center_id: 1, name: "Getting started", is_published: false }))
    .toBe('ldesk help-center collection create --help-center-id 1 --name "Getting started" --no-is-published');
});
it("renders json values in single quotes and positionals first", () => { /* ldesk articles get 42 --format html */ });
it("walks domain -> operation -> fields with a scripted prompt and runs once", async () => { /* scripted PromptAdapter */ });
```

- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4: Run, pass.**
- [ ] **Step 5: Manual check:** `node dist/index.js` in a terminal walks through `knowledge` -> `snippet_create` against the local instance and prints the command line.
- [ ] **Step 6: `npm run verify`, commit** `feat(cli): add interactive mode`

---

### Task 15: MCP server

**Files:**
- Create: `src/mcp/action-tool.ts`, `src/mcp/domain-tool.ts`, `src/mcp/request-tool.ts`, `src/mcp/status-tool.ts`, `src/mcp/instructions.ts`, `src/mcp/server.ts`
- Modify: `src/cli/program.ts` (`serve`), `src/index.ts`
- Test: `tests/mcp/action-tool.test.ts`, `tests/mcp/domain-tool.test.ts`, `tests/mcp/server.test.ts`, `tests/mcp/token-budget.test.ts`

**Interfaces:**
- Consumes: `Domain`, `Operation`, `runOperation`, `withProfile`, `buildCatalog`, `rawRequest`, `getStatus`, `maskSecrets`, `toLibreDeskError`.
- Produces:
  - From `action-tool.ts` (port of vex `src/tools/action-tool.ts`, using `server.registerTool` so annotations can be set): `type ToolResult`, `interface ActionDef { summary; shape; handler }`, `type ActionMap`, `toolErrorResult(err): ToolResult` (message plus `Hint:` line, `isError: true`), `jsonContent(data): ToolResult` (masked, compact JSON), `dispatchAction(actions, args): Promise<ToolResult>`, `actionTool(server, name, description, actions, annotations?: { destructiveHint?: boolean; readOnlyHint?: boolean }): void`. Every tool gets an optional `profile` param.
  - From `domain-tool.ts`: `domainActions(domain: Domain): ActionMap` (skips `mcp: false`; the action summary line is `<summary>` plus ` [undocumented]` plus ` CAUTION: <effect>` or ` DESTRUCTIVE: <effect>`), `registerDomainTool(server, domain): void` (annotations: `readOnlyHint` when every op is read, `destructiveHint` when any is destructive).
  - From `request-tool.ts`: `registerRequestTool(server, domains): void`: tool `libredesk_request`, actions `call` (`method`, `path`, `query`, `body`, `confirm`) and `catalog` (`domain`).
  - From `status-tool.ts`: `registerStatusTool(server): void`: tool `libredesk_status`, no params besides `profile`.
  - From `server.ts`: `parseToolsets(value: string | undefined): ReadonlySet<Toolset> | "all"` (unset means every toolset except `support`; `all` means everything; unknown names throw `ConfigError` listing valid ones), `selectDomains(domains, toolsets): Domain[]` (`core` is always on), `registerTools(server, env?: NodeJS.ProcessEnv): void`, `startMcpServer(): Promise<void>`.
  - From `instructions.ts`: `SERVER_INSTRUCTIONS: string`, covering, in at most 25 lines: the action-dispatch convention; profile selection and `libredesk_status`; the knowledge model (snippets are plain-text answers shared by all assistants; articles reach assistants only when `ai_enabled` is on and the status is `published`; FAQ suggestions become snippets when approved); write article content as markdown and resend HTML when `get` returned `content_format: "html"`; updates only need the fields that change; a conversation gets AI replies only when assigned to an assistant, usually by an automation rule; use `libredesk_lookup` for ids and `libredesk_request` with `catalog` for anything else; confirm caution and destructive actions with the user first.

- [ ] **Step 1: Write the failing tests.**

```ts
// tests/mcp/server.test.ts
it("default toolsets register exactly the phase 1 tools", () => {
  // names equal ["libredesk_help_center", "libredesk_articles", "libredesk_ai_knowledge", "libredesk_lookup", "libredesk_request", "libredesk_status"]
});
it("LIBREDESK_TOOLSETS=knowledge still includes core tools", () => { /* lookup, request, status present */ });
it("unknown toolset fails listing valid ones", () => { /* ConfigError message contains "knowledge" */ });

// tests/mcp/domain-tool.test.ts
it("marks destructive and caution actions in summaries", () => { /* ... */ });
it("sets destructiveHint when a domain has a destructive op", () => { /* ... */ });
it("returns a validation error naming the field for a missing required arg", async () => { /* ... */ });
it("masks secrets in tool results", async () => { /* ... */ });
it("runs inside withProfile when profile is passed", async () => { /* ... */ });

// tests/mcp/request-tool.test.ts (inside domain-tool or own file)
it("catalog filtered by domain lists actions with fields", async () => { /* ... */ });
it("call DELETE without confirm returns an error result", async () => { /* ... */ });
```

```ts
// tests/mcp/token-budget.test.ts: same measure() as vex tests/tools/token-budget.test.ts
// First run: print the measured size, then set DEFAULT_CEILING to measured * 1.1 rounded up to 500.
// Hard upper bound for phase 1: 9_000 characters for the default toolsets.
```

- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement the six files and wire `ldesk serve` and the no-args non-TTY path.**
- [ ] **Step 4: Run, see them pass. Record the measured token budget in the test comment.**
- [ ] **Step 5: Manual check with Claude Code.** `node dist/index.js mcp install --scope project --mode profile` in a scratch folder, start Claude Code there, ask it to list the help centers on the local instance and to create and then delete a draft article. Both work; the delete asks for confirmation through the client.
- [ ] **Step 6: `npm run verify`, commit** `feat(mcp): add MCP server with domain, request and status tools`

---

### Task 16: Docs and release readiness

**Files:**
- Create: `README.md`, `CLAUDE.md`
- Modify: `package.json` (version stays `0.0.0`; release-please bumps it)

**Interfaces:** none new.

- [ ] **Step 1: Write `README.md`** following vex's README structure: what it is; target LibreDesk version 2.9.2 and the documented vs undocumented split, with the full list of undocumented operations generated from `buildCatalog` (write a small `scripts/list-undocumented.mjs` that prints it, so the list can be regenerated); install; `ldesk login`; MCP setup both ways (env vars in the MCP config, stored login with `LIBREDESK_PROFILE`) with JSON examples for Claude Code and Claude Desktop; `LIBREDESK_TOOLSETS`; CLI examples for the help center, articles from markdown files (`--content @article.md`), snippets and FAQ suggestions; interactive mode; the local dev stack and live tests; how to add an operation (one `defineOperation` in a domain file, add the domain to `DOMAINS`). One line per paragraph.
- [ ] **Step 2: Write `CLAUDE.md`** for agents working in this repo, adapted from vex's: commands, the operation-definition architecture, how to add a domain, conventions, the undocumented-endpoint rule and where shapes come from, the live test workflow.
- [ ] **Step 3: Check the package.** `npm run build && npm pack --dry-run`. Expected: only `dist/`, `README.md`, `LICENSE`, `package.json`; `dist/index.js` starts with the shebang.
- [ ] **Step 4: Full verification.** `npm run verify`, `npm run test:coverage` (thresholds pass), `npm run test:live` against the local instance (all pass).
- [ ] **Step 5: Commit** `docs: add README and CLAUDE.md`

Publishing to npm and creating the GitHub repo are not part of this plan; they need Kevin's go-ahead.
