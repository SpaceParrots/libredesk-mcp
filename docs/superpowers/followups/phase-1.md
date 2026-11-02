# Phase 1 follow-ups

Deferred minor findings from the phase 1 task reviews and the final review. The final reviewer triaged all of them as safe to leave for later. Pick them up when touching the code in question.

- Task 1: .gitignore comment mentions vex saveFragment/saveOperation and has a double blank line
- Task 1: tests/smoke.test.ts has no @module block (constraint arguably covers src only)
- Task 2: redactText should replace longer secrets first (substring overlap)
- Task 2: maskSecrets flattens Date/Map/class instances to {} and has no cycle guard; errnoCode cause recursion unbounded
- Task 2: toLibreDeskError String(plainObject) gives "[object Object]"
- Task 2: tests missing cause-chain fetch-failed, ENOTFOUND/ETIMEDOUT, top-level array, mixed-case Headers
- Task 3: no test pinning concurrent withProfile isolation or nested withProfile(undefined)
- Task 3: fixed config.json.tmp name keeps a stale file's mode and collides on concurrent saves (secrets file) - final review should triage
- Task 3: parseConfig does not check activeProfile/projects point at existing profiles; EMPTY_CONFIG freeze is shallow; no test that override skips partial env
- Task 4: body starting with "{" parsed as JSON regardless of content type (untested); 401 fallback message and empty statusText untested; empty 200 body returns ""
- Task 4: NetworkError message now redacts only the reason, not the whole "METHOD url failed" string (URL query/userinfo unmasked)
- Task 5: bootstrap JSON.parse unguarded on 200; live env file written without mode 0600; bootstrap default URL ignores LD_PORT; vitest.live.config.ts no @module
- Task 5: tsconfig excludes tests/ so test files are linted but never type-checked (pre-existing, from vex)
- Task 6: z.literal(true) maps to enum ["true"]; z.preprocess maps to json; bivariant run accepts wider annotated input (tell domain implementers not to annotate run params)
- Task 6: nullable path param accepted at define time
- Task 7: link with only one of default target/rel is judged safe and write-back adds the other (editor default, benign); <li><p>x</p></li> writes back as tight <li>x</li>
- Task 7: literal ~ shows as &#126; in markdown read by agents; mention in the articles tool/field description (Task 9/15)
- Task 8: theme description misses footer_links/logo_url_dark and color_scheme values (system|light|dark); icon description should say lowercase, max 64, invalid dropped silently; collection locale change rejected once it has content; order keys not validated as integer strings
- Task 9: live author_id assertion trivial when null; live reorder result not read back; caller slug passes into merge (server ignores)
- Task 10: snippet_update test only uses an enabled snippet (a default-true regression survives); faq_approve mirror/neither cases untested; live update(enabled:false) does not re-check title/content; preview slice can split surrogate pairs
- Task 11: pick/asRecords not null-safe; non-array response silently becomes []; agents fixture lacks availability_status; live me check thin; process: no RED run
- Task 12: Effect line breaks group help table (use .summary); required positionals shown as optional; enum-array choices not listed in help; group description bland; duplicated "(required)"; domain help texts name MCP actions (set_status, collection_reorder); confirm.ts SECRET_KEYS camelCase never matches; singular/plural missing-positional message; @file-on-number test lacks "@"; loose confirm test; no TTY boolean/password prompt test; Z: drive test fragility
- Task 12: nullable boolean cannot be cleared from the CLI; cliInputError rewrite is text-based
- Task 13: no-args main failure bypasses handleCliError; TTY test gaps (login overwrite confirm, profile link select, mcp env yes, status 401, request --json); repeated --query overwrites; profile remove unconfirmed; empty secret accepted until verify
- Task 13: raw-request guard accepts a leading "//" (guard parses a host; sent URL stays same-host, harmless 404) - one-line reject + test; .mcp.json chmod after write leaves a brief window
- Task 14: nullable fields cannot be set to null from the menu (flag path covers it); literal "null" string on nullable field round-trips to null
- Task 14: dash test does not parse the emitted line back through commander; flagWith one-liner readability; manual TTY walk-through of `ldesk` still to be done by the user
- Task 15: merged schema keeps list's positive-int collection_id so get/delete cannot pass 0 (comment at mergeShapes); CLI help lost find-it hints and custom_domain "no path, no trailing slash"; weak TDD evidence
- Task 16: CLAUDE.md test-name wording vs snippet test name; --no-ai-enabled help shows positive description
- Final review: ai-knowledge/help-center/articles list helpers still turn non-arrays into [] silently; CLAUDE.md collection test name; entry-point catch prints its own Error line (stderr only)
- Final review: snippet_list/faq_list, help-center list/collection list/tree, articles get/list still degrade silently on an HTML body (read-only; route through requireList/requireRecord in phase 2)

Still to do by hand: walk through the interactive menu (`ldesk` with no arguments) once in a real terminal, since the prompt adapter has no automated test.
