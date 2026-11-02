/**
 * @module constants
 * Shared constants: package identity, target LibreDesk version, env var names and defaults.
 */

/** LibreDesk release this package is built and tested against. */
export const LIBREDESK_TARGET_VERSION = "2.9.2";

/** Names of the environment variables the CLI and MCP server read. */
export const ENV = {
  URL: "LIBREDESK_URL",
  API_KEY: "LIBREDESK_API_KEY",
  API_SECRET: "LIBREDESK_API_SECRET",
  PROFILE: "LIBREDESK_PROFILE",
  TOOLSETS: "LIBREDESK_TOOLSETS",
  CONFIG_DIR: "LIBREDESK_CONFIG_DIR",
} as const;

/** Name of the config directory inside the user's home directory. */
export const DEFAULT_CONFIG_DIR_NAME = ".libredesk-mcp";

/** Name of the implicit profile built from the three credential env vars. */
export const IMPLICIT_ENV_PROFILE = "env";

/** Timeout for a single HTTP request to LibreDesk, in milliseconds. */
export const HTTP_TIMEOUT_MS = 30_000;

/** npm package name. */
export const PACKAGE_NAME = "@spaceparrots/libredesk-mcp";

/** Name of the installed binary. */
export const BIN_NAME = "ldesk";

/** Hint shown when a server answers 2xx with something that is not the LibreDesk API (usually a wrong base URL). */
export const BASE_URL_HINT = "Check the LibreDesk base URL, including any path prefix such as /helpdesk.";
