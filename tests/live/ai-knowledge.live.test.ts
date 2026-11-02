/**
 * @module tests/live/ai-knowledge.live.test
 * Live round trip of the AI knowledge domain against a local LibreDesk. Creates one snippet and
 * removes it again; flips FAQ learning and restores it. Snippet embedding runs in the background,
 * so creating a snippet works without an AI provider. `snippet_import_url` runs only when
 * `LIBREDESK_LIVE_IMPORT_URL` is set.
 */

import { afterAll, describe, expect, it } from "vitest";
import { aiKnowledgeDomain } from "../../src/domains/ai-knowledge.js";
import { runOperation } from "../../src/ops/run.js";
import { liveProfile, uniqueName, writesAllowed } from "./helpers.js";

function op(name: string) {
  const found = aiKnowledgeDomain.operations.find((o) => o.name === name);
  if (!found) throw new Error(`no operation ${name}`);
  return found;
}

function run(name: string, input: Record<string, unknown> = {}): Promise<unknown> {
  return runOperation(op(name), input, { profile: liveProfile()! });
}

interface Snippet {
  readonly id: number;
  readonly title: string;
  readonly content: string;
  readonly enabled: boolean;
}

describe.skipIf(!liveProfile() || !writesAllowed())("AI knowledge against local LibreDesk", () => {
  const snippetIds: number[] = [];

  afterAll(async () => {
    for (const id of snippetIds) await run("snippet_delete", { id }).catch(() => undefined);
  });

  it("creates, searches, updates and deletes a snippet", async () => {
    const title = uniqueName("snippet");
    const content = `Self-contained answer for ${title}.`;

    const created = (await run("snippet_create", { title, content })) as Snippet;
    snippetIds.push(created.id);
    expect(created.enabled).toBe(true);

    const found = (await run("snippet_list", { search: title })) as { id: number; preview: string }[];
    expect(found.map((s) => s.id)).toEqual([created.id]);
    expect(found[0]?.preview).toBe(content);

    const fetched = (await run("snippet_get", { id: created.id })) as Snippet;
    expect(fetched.content).toBe(content);

    await run("snippet_update", { id: created.id, title: `${title} renamed` });
    const updated = (await run("snippet_get", { id: created.id })) as Snippet;
    expect(updated.title).toBe(`${title} renamed`);
    expect(updated.content).toBe(content);
    expect(updated.enabled).toBe(true);

    await run("snippet_update", { id: created.id, enabled: false });
    const disabled = (await run("snippet_list", { enabled: false, search: title })) as { id: number }[];
    expect(disabled.map((s) => s.id)).toEqual([created.id]);

    await run("snippet_delete", { id: created.id });
    snippetIds.pop();
    const rest = (await run("snippet_list", { search: title })) as unknown[];
    expect(rest).toEqual([]);
  });

  it.skipIf(!process.env.LIBREDESK_LIVE_IMPORT_URL)("imports a snippet from a URL", async () => {
    const imported = (await run("snippet_import_url", { url: process.env.LIBREDESK_LIVE_IMPORT_URL })) as Snippet;
    snippetIds.push(imported.id);
    expect(imported.id).toBeGreaterThan(0);
  });

  it("lists FAQ suggestions", async () => {
    expect(Array.isArray(await run("faq_list"))).toBe(true);
    expect(Array.isArray(await run("faq_list", { status: "pending" }))).toBe(true);
  });

  it("flips FAQ learning and restores it", async () => {
    const original = ((await run("learning_get")) as { enabled: boolean }).enabled;
    try {
      await run("learning_set", { enabled: !original });
      expect(((await run("learning_get")) as { enabled: boolean }).enabled).toBe(!original);
    } finally {
      await run("learning_set", { enabled: original });
    }
    expect(((await run("learning_get")) as { enabled: boolean }).enabled).toBe(original);
  });
});
