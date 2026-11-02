# API coverage

`ldesk` targets LibreDesk **2.9.2**. Other versions may work, but endpoint shapes are only checked against 2.9.2.

LibreDesk publishes an [OpenAPI spec](https://docs.libredesk.io/api-reference/openapi.json), but the help center, article and AI knowledge endpoints are not in it. Their shapes were taken from the LibreDesk 2.9.2 source code. Operations built that way carry an `undocumented` flag, mentioned in the `--help` of their command group and shown in `ldesk catalog`. They can change between LibreDesk releases without notice, so check them after an upgrade.

Of 45 operations, 39 are undocumented. Only `lookup me`, `tags`, `inboxes`, `statuses`, `priorities` and `custom-attributes` come from the documented spec:

- `libredesk_help_center`: `list`, `get`, `locales`, `tree`, `insights`, `create`, `update`, `toggle`, `delete`, `collection_list`, `collection_create`, `collection_update`, `collection_toggle`, `collection_reorder`, `collection_delete`
- `libredesk_articles`: `list`, `get`, `create`, `update`, `set_status`, `move`, `reorder`, `linkable`, `link_translation`, `unlink_translation`, `delete`
- `libredesk_ai_knowledge`: `snippet_list`, `snippet_get`, `snippet_create`, `snippet_update`, `snippet_import_url`, `snippet_delete`, `faq_list`, `faq_approve`, `faq_reject`, `learning_get`, `learning_set`
- `libredesk_lookup`: `agents`, `teams`

To regenerate the list with methods and paths, build first because the script imports from `dist/`:

```bash
npm run build
npm run docs:undocumented
```

Every other endpoint, documented or not, is reachable through `ldesk request` and the `libredesk_request` MCP tool. See [the CLI reference](cli.md#raw-requests).
