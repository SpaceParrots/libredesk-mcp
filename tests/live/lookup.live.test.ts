/**
 * @module tests/live/lookup.live.test
 * Live check of the lookup domain against a local LibreDesk. Read-only.
 */

import { describe, expect, it } from "vitest";
import { lookupDomain } from "../../src/domains/lookup.js";
import { runOperation } from "../../src/ops/run.js";
import { liveProfile } from "./helpers.js";

function run(name: string, input: Record<string, unknown> = {}): Promise<unknown> {
  const op = lookupDomain.operations.find((o) => o.name === name);
  if (!op) throw new Error(`no operation ${name}`);
  return runOperation(op, input, { profile: liveProfile()! });
}

describe.skipIf(!liveProfile())("lookup against local LibreDesk", () => {
  it.each(["agents", "teams", "tags", "inboxes", "statuses", "priorities", "custom_attributes"])("%s returns an array", async (name) => {
    expect(Array.isArray(await run(name))).toBe(true);
  });

  it("custom_attributes accepts applies_to", async () => {
    expect(Array.isArray(await run("custom_attributes", { applies_to: "contact" }))).toBe(true);
  });

  it("me returns the current agent without api key fields", async () => {
    const me = (await run("me")) as Record<string, unknown>;
    expect(typeof me.id).toBe("number");
    expect(me).not.toHaveProperty("api_key");
  });
});
