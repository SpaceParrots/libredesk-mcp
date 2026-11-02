/**
 * @module tests/live/help-center.live.test
 * Live round trip of the help center domain against a local LibreDesk. Creates a help center with
 * two collections and removes everything again.
 */

import { afterAll, describe, expect, it } from "vitest";
import { helpCenterDomain } from "../../src/domains/help-center.js";
import { runOperation } from "../../src/ops/run.js";
import { liveProfile, uniqueName, writesAllowed } from "./helpers.js";

function op(name: string) {
  const found = helpCenterDomain.operations.find((o) => o.name === name);
  if (!found) throw new Error(`no operation ${name}`);
  return found;
}

function run(name: string, input: Record<string, unknown> = {}): Promise<unknown> {
  return runOperation(op(name), input, { profile: liveProfile()! });
}

interface Created {
  readonly id: number;
}

describe.skipIf(!liveProfile() || !writesAllowed())("help center against local LibreDesk", () => {
  let helpCenterId: number | undefined;
  const collectionIds: number[] = [];

  afterAll(async () => {
    if (helpCenterId === undefined) return;
    for (const id of collectionIds) {
      await run("collection_delete", { help_center_id: helpCenterId, id }).catch(() => undefined);
    }
    await run("delete", { id: helpCenterId }).catch(() => undefined);
  });

  it("creates, updates, organises and removes a help center", async () => {
    const title = uniqueName("hc");
    const slug = title.toLowerCase();

    const created = (await run("create", {
      name: title,
      slug,
      page_title: title,
      default_locale: "en",
      allowed_locales: ["en", "de"],
      theme: { color: "#123456" },
    })) as Created;
    helpCenterId = created.id;

    const fetched = (await run("get", { id: helpCenterId })) as Record<string, unknown>;
    expect(fetched.slug).toBe(slug);

    await run("update", { id: helpCenterId, page_title: `${title} updated` });
    const updated = (await run("get", { id: helpCenterId })) as Record<string, unknown>;
    expect(updated.page_title).toBe(`${title} updated`);
    expect(updated.slug).toBe(slug);
    expect(updated.allowed_locales).toEqual(["en", "de"]);
    expect((updated.theme as Record<string, unknown>).color).toBe("#123456");

    const first = (await run("collection_create", { help_center_id: helpCenterId, name: "First" })) as Created;
    const second = (await run("collection_create", { help_center_id: helpCenterId, name: "Second" })) as Created;
    collectionIds.push(first.id, second.id);

    await run("collection_reorder", { help_center_id: helpCenterId, order: { [second.id]: 0, [first.id]: 1 } });
    await run("collection_toggle", { id: first.id });
    await run("collection_update", { help_center_id: helpCenterId, id: first.id, description: "Hello" });

    const collections = (await run("collection_list", { help_center_id: helpCenterId })) as Record<string, unknown>[];
    const firstListed = collections.find((c) => c.id === first.id);
    expect(firstListed?.is_published).toBe(true);
    expect(firstListed?.sort_order).toBe(1);
    expect(collections.find((c) => c.id === second.id)?.sort_order).toBe(0);

    const published = (await run("collection_publish", { help_center_id: helpCenterId, id: [first.id, second.id], is_published: true })) as { ok: number };
    expect(published.ok).toBe(2);
    const afterPublish = (await run("collection_list", { help_center_id: helpCenterId })) as Record<string, unknown>[];
    expect(afterPublish.filter((c) => c.id === first.id || c.id === second.id).map((c) => c.is_published)).toEqual([true, true]);

    const tree = (await run("tree", { id: helpCenterId })) as { tree: Record<string, unknown>[] };
    expect(tree.tree.map((c) => c.id).sort()).toEqual([first.id, second.id].sort());

    for (const id of collectionIds.splice(0)) {
      await run("collection_delete", { help_center_id: helpCenterId, id });
    }
    await run("delete", { id: helpCenterId });
    helpCenterId = undefined;
  });
});
