/**
 * @module domains
 * Registry of all operation domains. The CLI, the MCP server and the catalog are built from it.
 */

import type { Domain } from "../ops/define.js";
import { articlesDomain } from "./articles.js";
import { helpCenterDomain } from "./help-center.js";

/** Every domain, in the order they appear in `--help` and the tool list. */
export const DOMAINS: readonly Domain[] = [helpCenterDomain, articlesDomain];
