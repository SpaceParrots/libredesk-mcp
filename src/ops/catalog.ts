/**
 * @module ops/catalog
 * Flat list of every declared operation, shared by `ldesk catalog` and the MCP server.
 */

import type { HttpMethod } from "../http.js";
import type { Domain, Impact } from "./define.js";
import { operationFields, type FieldInfo } from "./fields.js";

/** One operation as listed in the catalog. */
export interface CatalogEntry {
  /** CLI command of the domain. */
  readonly domain: string;
  /** MCP tool name of the domain. */
  readonly tool: string;
  /** Operation name, the MCP action. */
  readonly action: string;
  /** HTTP method of the default request. */
  readonly method: HttpMethod;
  /** Path template. */
  readonly path: string;
  /** One-line summary. */
  readonly summary: string;
  /** How much the operation changes. */
  readonly impact: Impact;
  /** True when built from the LibreDesk source rather than the OpenAPI spec. */
  readonly undocumented: boolean;
  /** Input fields. */
  readonly fields: readonly FieldInfo[];
}

/** List the operations of `domains`, optionally only those of the domain whose name or tool equals `filter`. */
export function buildCatalog(domains: readonly Domain[], filter?: string): CatalogEntry[] {
  return domains
    .filter((domain) => filter === undefined || domain.name === filter || domain.tool === filter)
    .flatMap((domain) =>
      domain.operations.map((op) => ({
        domain: domain.name,
        tool: domain.tool,
        action: op.name,
        method: op.method,
        path: op.path,
        summary: op.summary,
        impact: op.impact,
        undocumented: op.undocumented ?? false,
        fields: operationFields(op),
      })),
    );
}
