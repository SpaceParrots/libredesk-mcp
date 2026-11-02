# Changelog

## 1.0.0 (2026-11-02)


### Features

* add error types and secret masking ([0fdf114](https://github.com/SpaceParrots/libredesk-mcp/commit/0fdf114a4802eeccd856229fc5666d9e9d500b81))
* add LibreDesk HTTP client ([5db24a3](https://github.com/SpaceParrots/libredesk-mcp/commit/5db24a3c4bd8d09766d56675fbec70697df4c29e))
* add markdown conversion for article content ([befd487](https://github.com/SpaceParrots/libredesk-mcp/commit/befd4875c3ff65a86c11ebb049df6edd1a7fc6f4))
* add operation definitions and runner ([5828e8d](https://github.com/SpaceParrots/libredesk-mcp/commit/5828e8d0d339cdd816f91995608793a429dc6b8b))
* add profile store and resolution ([03a9ee0](https://github.com/SpaceParrots/libredesk-mcp/commit/03a9ee05ef190412e8cc877e4074cc77fad6fdce))
* **articles:** add article operations with markdown content ([dffc193](https://github.com/SpaceParrots/libredesk-mcp/commit/dffc19374367dbd7f6f7c203efd39aa8dad06315))
* **cli:** add interactive mode ([6f1b7e3](https://github.com/SpaceParrots/libredesk-mcp/commit/6f1b7e31a2888811904eb49f54a7ca36f371aa84))
* **cli:** add login, profiles, status, request and mcp install ([2b7b71d](https://github.com/SpaceParrots/libredesk-mcp/commit/2b7b71d146db05dd8e00f9918fc73b5afe62efb8))
* **cli:** generate commands from operation definitions ([ff39f31](https://github.com/SpaceParrots/libredesk-mcp/commit/ff39f316d3e37ed9bc7658d2ac75b3d353412e2e))
* **cli:** make help self-explanatory for agents with examples, notes and conditional confirmation ([3c27414](https://github.com/SpaceParrots/libredesk-mcp/commit/3c274144fe57c09df570aeb62fcbf1890255ffd3))
* **help-center:** add help center and collection operations ([a16ec2d](https://github.com/SpaceParrots/libredesk-mcp/commit/a16ec2d4981399efa723c46f9fa250879e54231b))
* **knowledge:** add AI snippet and FAQ suggestion operations ([f901b02](https://github.com/SpaceParrots/libredesk-mcp/commit/f901b02538abb748dcf6308ab002cde6405f0646))
* **lookup:** add read-only lookups ([0d2530c](https://github.com/SpaceParrots/libredesk-mcp/commit/0d2530cdf62abfc6e6d09970c845b9aa2a0a1b7a))
* **mcp:** add MCP server with domain, request and status tools ([b115bd3](https://github.com/SpaceParrots/libredesk-mcp/commit/b115bd3bc449e5bbae27a140ba8b57cc5a5c6b21))


### Bug Fixes

* **cli:** accept --no-x for every boolean flag ([0f4555f](https://github.com/SpaceParrots/libredesk-mcp/commit/0f4555f9951ebdd9f1340677d91a7c0a29402470))
* **cli:** check TTY for ldesk i, route startup errors through the handler, reject URL userinfo ([07290da](https://github.com/SpaceParrots/libredesk-mcp/commit/07290da01e74a445d55f1c68ccd01b55a798b90a))
* **cli:** clarify locale, slug, snippet paging, html output and status fields in help ([c9dc248](https://github.com/SpaceParrots/libredesk-mcp/commit/c9dc248f99863de591609641c744ff1471d8c980))
* **cli:** confirm collection publishing and enabling FAQ learning, name CLI commands in not-found hints ([56d8c88](https://github.com/SpaceParrots/libredesk-mcp/commit/56d8c8831499609daaf5df1104f8df2b0ac72f96))
* **cli:** harden raw request paths and gate secret printing ([3b81adf](https://github.com/SpaceParrots/libredesk-mcp/commit/3b81adf78bb0ba1059e20399b1b849790f7a50c3))
* **cli:** keep interactive session alive after a declined confirmation ([e8267ae](https://github.com/SpaceParrots/libredesk-mcp/commit/e8267ae73dd81eeaa32233f26f19cfc7381d5cd6))
* **cli:** name flags in errors and accept null for nullable fields ([7029de8](https://github.com/SpaceParrots/libredesk-mcp/commit/7029de83f7c142b1a1e70c6f4f92ee8fc47f846c))
* close false-safe gaps in markdown conversion ([8c9b45c](https://github.com/SpaceParrots/libredesk-mcp/commit/8c9b45ccf2f0cdb82eb924ade72e2e7ef2dbef65))
* guard operation definitions and type-check tests ([a55fc2f](https://github.com/SpaceParrots/libredesk-mcp/commit/a55fc2f01a48b9e408a1b9226d93543722ff87b1))
* **http:** reject 2xx responses that are not JSON and non-object records ([9d4c535](https://github.com/SpaceParrots/libredesk-mcp/commit/9d4c5356cd5cdd29b16b5f9470738323a0ce5afd))
* **http:** return text for non-JSON responses and detect a wrong base URL where JSON is expected ([024e38c](https://github.com/SpaceParrots/libredesk-mcp/commit/024e38c7de14f7dcdceedec03deda99fe01b2243))
* keep list hard breaks and escape tildes in markdown conversion ([1ae06a0](https://github.com/SpaceParrots/libredesk-mcp/commit/1ae06a0fa7223e5d8a7a77b17bcd3513a0d3c02f))
* **lookup:** treat a null list as empty ([34d236b](https://github.com/SpaceParrots/libredesk-mcp/commit/34d236bcdfb6552caea2ff7dec49de87a382c4fd))
* **mcp:** name the query field instead of CLI flags in request hints ([fbbf28c](https://github.com/SpaceParrots/libredesk-mcp/commit/fbbf28c8f92e9df04c9b5e6ef83fd570ffb636cf))
* **mcp:** qualify merged field descriptions and pin per-action defaults ([a471486](https://github.com/SpaceParrots/libredesk-mcp/commit/a471486a8d8dddfe94072221c4eb72f5e283ec99))
* **ops:** reserve action, profile, json and yes as input field names ([d647e22](https://github.com/SpaceParrots/libredesk-mcp/commit/d647e22dff0b784700c963ba1ee4a75e28bf178d))
* redact secrets from network error cause and pin base url handling ([74e6b6b](https://github.com/SpaceParrots/libredesk-mcp/commit/74e6b6b4e78483edf67a7b854f453595c5876be6))
* reject profile names inherited from Object.prototype ([9e544b7](https://github.com/SpaceParrots/libredesk-mcp/commit/9e544b7f0b4aa8f0a05e823a748c08891deb7a2a))
* **status:** exit 1 when no profile resolves or the server is not reachable ([b8b99c0](https://github.com/SpaceParrots/libredesk-mcp/commit/b8b99c0809c5382f255174af9f73ab8000668cc4))
