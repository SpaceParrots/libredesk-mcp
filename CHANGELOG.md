# Changelog

## [0.2.0](https://github.com/SpaceParrots/libredesk-mcp/compare/v0.1.0...v0.2.0) (2026-11-03)


### Features

* **articles:** add sync from local markdown files and a visibility check for AI assistants ([0b5fbca](https://github.com/SpaceParrots/libredesk-mcp/commit/0b5fbcaa421d4183537f3914e23bb69d88063756))
* **cli:** add ldesk doctor to check the profile and how the MCP client launches the server ([e597ae3](https://github.com/SpaceParrots/libredesk-mcp/commit/e597ae33e9977eeaa21bc8f0befa7df9c2628fa9))
* **mcp:** move publishing and deletes into libredesk_publish and libredesk_delete, add bulk ids and short write results ([5bd05f9](https://github.com/SpaceParrots/libredesk-mcp/commit/5bd05f9b49872d3e2476bb5896d7820016ded9fa))


### Bug Fixes

* **articles:** read links with only nofollow, noopener or noreferrer rel back as markdown ([d68254c](https://github.com/SpaceParrots/libredesk-mcp/commit/d68254c87034e1c74a0a268c87e667a90adcc37f))
* **articles:** stop sync from rewriting unchanged articles that contain tables, task lists or html ([4605551](https://github.com/SpaceParrots/libredesk-mcp/commit/4605551cdaad7bc14d1b4f977e690fecec8aa69a))
* **cli:** ask before doctor starts a server command from the project config of the current folder ([a19782d](https://github.com/SpaceParrots/libredesk-mcp/commit/a19782d6a12bed67ac6677258cada4a040f838a2))
* **cli:** escape terminal control and bidi characters in text output ([e57ccf2](https://github.com/SpaceParrots/libredesk-mcp/commit/e57ccf234c2518fe028e074ad9d3d6995aeea3db))
* close the security audit findings and harden the CLI and MCP server ([160010c](https://github.com/SpaceParrots/libredesk-mcp/commit/160010c1b25478e4ec5f6d7b31606f0e9aa053d6))
* **config:** write the config through an exclusive temp file, refuse a symlinked project file and warn on plain http ([cdd3cbc](https://github.com/SpaceParrots/libredesk-mcp/commit/cdd3cbc1a02b1da5ee6f27e8e0b957c3384234e8))
* **doctor:** ask before starting entries the current folder can redirect and hide values filled in from env vars ([58e7700](https://github.com/SpaceParrots/libredesk-mcp/commit/58e7700e23d180943426deafb0a8f38125d85a12))
* **http:** redact the secret from response bodies and before cutting error text ([472b772](https://github.com/SpaceParrots/libredesk-mcp/commit/472b77293b275b414860e968509475a6f2949f44))
* **mcp:** accept lists of ids in libredesk_publish, whose merged schema typed id as one number ([0f1fcee](https://github.com/SpaceParrots/libredesk-mcp/commit/0f1fceee92699e319e766ae1223bffd2181d3131))
* **mcp:** route moves and custom code through publish, keep sync inside the server folder and limit profiles ([a9cc1ca](https://github.com/SpaceParrots/libredesk-mcp/commit/a9cc1ca28ca318b4447ce12469adb936a3e2a76e))
* **mcp:** tell the model that edits to published articles and enabled snippets go live at once ([36e01c4](https://github.com/SpaceParrots/libredesk-mcp/commit/36e01c4d793e6e74f89f2eee9c4bed68039b7631))
* **request:** reject dot segments that could leave the base URL path ([1bb093b](https://github.com/SpaceParrots/libredesk-mcp/commit/1bb093bc4e378dc1a0d7d14e3b8f54ae4b3052b0))

## 0.1.0 (2026-11-02)


### Features

* add error types and secret masking ([c2fe478](https://github.com/SpaceParrots/libredesk-mcp/commit/c2fe4787c982bb1f833a0da7741fe9eb14551566))
* add LibreDesk HTTP client ([240710c](https://github.com/SpaceParrots/libredesk-mcp/commit/240710cf7a8e5916c0193e5e1ec9377fc24659db))
* add markdown conversion for article content ([49c24af](https://github.com/SpaceParrots/libredesk-mcp/commit/49c24af9c68f280223b3e973d0b3e75f8d6ba5c3))
* add operation definitions and runner ([a2d0ad4](https://github.com/SpaceParrots/libredesk-mcp/commit/a2d0ad455b8329cd9246059978c9345956f989a9))
* add profile store and resolution ([7fa8d01](https://github.com/SpaceParrots/libredesk-mcp/commit/7fa8d01c7fa88b226a893c987e49f87d7de55032))
* **articles:** add article operations with markdown content ([2ad90c7](https://github.com/SpaceParrots/libredesk-mcp/commit/2ad90c76fc796901ec25df01095bd5e854a38bbb))
* **cli:** add interactive mode ([ac3bd1a](https://github.com/SpaceParrots/libredesk-mcp/commit/ac3bd1a47de6a814365a46fa953660d6d802645f))
* **cli:** add login, profiles, status, request and mcp install ([01fbcf2](https://github.com/SpaceParrots/libredesk-mcp/commit/01fbcf276d21cfbd469c2f9f3de8f402e563a901))
* **cli:** generate commands from operation definitions ([ec47779](https://github.com/SpaceParrots/libredesk-mcp/commit/ec47779989e3185eac96d1399b7e4fe29ab824e4))
* **cli:** make help self-explanatory for agents with examples, notes and conditional confirmation ([b909203](https://github.com/SpaceParrots/libredesk-mcp/commit/b909203a2464debbe90d8ef27cafda9ee7abef12))
* **help-center:** add help center and collection operations ([63ae06c](https://github.com/SpaceParrots/libredesk-mcp/commit/63ae06c8b8611efa12772892cb4d10cba6326af0))
* **knowledge:** add AI snippet and FAQ suggestion operations ([f3fe66a](https://github.com/SpaceParrots/libredesk-mcp/commit/f3fe66a877d920b6178c5d5910b4e4ffebf19b6a))
* **lookup:** add read-only lookups ([00432fa](https://github.com/SpaceParrots/libredesk-mcp/commit/00432fa6dea09a401886c25a5e01c86a6e0cb93f))
* **mcp:** add MCP server with domain, request and status tools ([054a629](https://github.com/SpaceParrots/libredesk-mcp/commit/054a629b115d00accfdc63a2cdd0887e25e0d87d))


### Bug Fixes

* **cli:** accept --no-x for every boolean flag ([3c572b1](https://github.com/SpaceParrots/libredesk-mcp/commit/3c572b1bf6ce0a304a9daaae69731ad1eab51265))
* **cli:** check TTY for ldesk i, route startup errors through the handler, reject URL userinfo ([0b6bbe3](https://github.com/SpaceParrots/libredesk-mcp/commit/0b6bbe36327c114ddf087dd882ba1731ef109353))
* **cli:** clarify locale, slug, snippet paging, html output and status fields in help ([272b2ba](https://github.com/SpaceParrots/libredesk-mcp/commit/272b2ba0f0873c3549967bda7f404376b092938e))
* **cli:** confirm collection publishing and enabling FAQ learning, name CLI commands in not-found hints ([e407842](https://github.com/SpaceParrots/libredesk-mcp/commit/e4078429d556eba3059e069319bfe9b7a4088fb6))
* **cli:** harden raw request paths and gate secret printing ([d73ac3f](https://github.com/SpaceParrots/libredesk-mcp/commit/d73ac3f6e600d50d510a1b9894a79bd6c9e11a6c))
* **cli:** keep interactive session alive after a declined confirmation ([05306d4](https://github.com/SpaceParrots/libredesk-mcp/commit/05306d47a4e6d6fd6199c8e06d28448d20b2aeff))
* **cli:** name flags in errors and accept null for nullable fields ([7adfceb](https://github.com/SpaceParrots/libredesk-mcp/commit/7adfceb02257d12c4c0a56d6e4db5231a4651542))
* close false-safe gaps in markdown conversion ([f128e0e](https://github.com/SpaceParrots/libredesk-mcp/commit/f128e0ef249fea5bd50680af8b56dcb9b69e4d91))
* guard operation definitions and type-check tests ([22ef335](https://github.com/SpaceParrots/libredesk-mcp/commit/22ef335387384f6de0b32106c6d6d62337d34edd))
* **http:** reject 2xx responses that are not JSON and non-object records ([b9d3a50](https://github.com/SpaceParrots/libredesk-mcp/commit/b9d3a509402e7cd91830bdbea326b3762c68f11d))
* **http:** return text for non-JSON responses and detect a wrong base URL where JSON is expected ([1185a24](https://github.com/SpaceParrots/libredesk-mcp/commit/1185a247a05d5a874fb3065953b75a69d966fecb))
* keep list hard breaks and escape tildes in markdown conversion ([a6c53b0](https://github.com/SpaceParrots/libredesk-mcp/commit/a6c53b0bdd5e532ad05f2bbf8a170e60360e6891))
* **lookup:** treat a null list as empty ([3b9a473](https://github.com/SpaceParrots/libredesk-mcp/commit/3b9a47318250fc3985b76a5cc2acb98f97333aff))
* **mcp:** name the query field instead of CLI flags in request hints ([c698c40](https://github.com/SpaceParrots/libredesk-mcp/commit/c698c40847c3320393149f5c8fde0172a27f662b))
* **mcp:** qualify merged field descriptions and pin per-action defaults ([56c24a2](https://github.com/SpaceParrots/libredesk-mcp/commit/56c24a2f3dbb949c07def4a6ee3e7bc05ccb1a0f))
* **ops:** reserve action, profile, json and yes as input field names ([4fe8a36](https://github.com/SpaceParrots/libredesk-mcp/commit/4fe8a369b93731a22359cbddec7d935b7ec82c6e))
* redact secrets from network error cause and pin base url handling ([77ec57d](https://github.com/SpaceParrots/libredesk-mcp/commit/77ec57d9bdcd29fd10e9c06baf0a1acc2839ef89))
* reject profile names inherited from Object.prototype ([a34542c](https://github.com/SpaceParrots/libredesk-mcp/commit/a34542c7422b8f2d65dd1a936e169d6af9a2ad15))
* **status:** exit 1 when no profile resolves or the server is not reachable ([c32645d](https://github.com/SpaceParrots/libredesk-mcp/commit/c32645df8103f68fa83beb6607a078aa93497245))
