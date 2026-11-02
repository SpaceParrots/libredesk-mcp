/**
 * @module list-undocumented
 * Prints the operations built from the LibreDesk source instead of the documented OpenAPI spec,
 * as a markdown list grouped by MCP tool. Run after `npm run build`; paste the output into README.md.
 */

import { DOMAINS } from "../dist/domains/index.js";
import { buildCatalog } from "../dist/ops/catalog.js";

const entries = buildCatalog(DOMAINS);
const undocumented = entries.filter((entry) => entry.undocumented);
console.log(`${undocumented.length} of ${entries.length} operations are undocumented.\n`);

const tools = [...new Set(undocumented.map((entry) => entry.tool))];
for (const tool of tools) {
  console.log(`${tool}:\n`);
  for (const entry of undocumented.filter((e) => e.tool === tool)) {
    console.log(`- \`${entry.action}\` (${entry.method} ${entry.path})`);
  }
  console.log("");
}
