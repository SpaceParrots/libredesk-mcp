/**
 * @module tests/live/articles.live.test
 * Live round trip of the articles domain against a local LibreDesk. Creates a help center with two
 * locales and one collection per locale, and removes everything again.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { articlesDomain } from "../../src/domains/articles.js";
import { helpCenterDomain } from "../../src/domains/help-center.js";
import { runOperation } from "../../src/ops/run.js";
import { liveProfile, uniqueName, writesAllowed } from "./helpers.js";

function find(domain: { operations: readonly { name: string }[] }, name: string) {
  const found = domain.operations.find((o) => o.name === name);
  if (!found) throw new Error(`no operation ${name}`);
  return found as (typeof articlesDomain.operations)[number];
}

function art(name: string, input: Record<string, unknown> = {}): Promise<unknown> {
  return runOperation(find(articlesDomain, name), input, { profile: liveProfile()! });
}

function hc(name: string, input: Record<string, unknown> = {}): Promise<unknown> {
  return runOperation(find(helpCenterDomain, name), input, { profile: liveProfile()! });
}

interface Created {
  readonly id: number;
}

describe.skipIf(!liveProfile() || !writesAllowed())("articles against local LibreDesk", () => {
  let helpCenterId: number | undefined;
  const articleIds: number[] = [];
  const collectionIds: number[] = [];

  afterAll(async () => {
    for (const id of articleIds) await art("delete", { id }).catch(() => undefined);
    if (helpCenterId === undefined) return;
    for (const id of collectionIds) await hc("collection_delete", { help_center_id: helpCenterId, id }).catch(() => undefined);
    await hc("delete", { id: helpCenterId }).catch(() => undefined);
  });

  it("creates, edits, publishes, translates, moves and removes articles", async () => {
    const name = uniqueName("art");
    const created = (await hc("create", {
      name,
      slug: name.toLowerCase(),
      page_title: name,
      default_locale: "en",
      allowed_locales: ["en", "de"],
    })) as Created;
    helpCenterId = created.id;
    const en = (await hc("collection_create", { help_center_id: helpCenterId, name: "English", locale: "en" })) as Created;
    const de = (await hc("collection_create", { help_center_id: helpCenterId, name: "Deutsch", locale: "de" })) as Created;
    const en2 = (await hc("collection_create", { help_center_id: helpCenterId, name: "English two", locale: "en" })) as Created;
    collectionIds.push(en.id, de.id, en2.id);

    const first = (await art("create", {
      collection_id: en.id,
      title: "Refunds",
      content: "## Policy\n\nSee [docs](https://example.com) and ~~old~~ text.",
      excerpt: "How refunds work",
    })) as Record<string, unknown>;
    const firstId = first.id as number;
    articleIds.push(firstId);
    expect(first.status).toBe("draft");
    expect(first.ai_enabled).toBe(true);

    // LibreDesk ignores the collection segment of the get path
    const fetched = (await art("get", { id: firstId })) as Record<string, unknown>;
    expect(fetched.note).toBeUndefined();
    expect(fetched.content_format).toBe("markdown");
    expect(fetched.content).toContain("## Policy");
    expect(fetched.content).toContain("~~old~~");
    expect(fetched.translations).toBeDefined();

    await art("update", { id: firstId, title: "Refunds v2" });
    const updated = (await art("get", { id: firstId })) as Record<string, unknown>;
    expect(updated.title).toBe("Refunds v2");
    expect(updated.ai_enabled).toBe(true);
    expect(updated.status).toBe("draft");
    expect(updated.excerpt).toBe("How refunds work");
    expect(updated.author_id).toBe(fetched.author_id);
    expect(updated.content).toBe(fetched.content);

    await art("set_status", { id: firstId, status: "published" });
    const listed = (await art("list", { help_center_id: helpCenterId })) as Record<string, unknown>[];
    const entry = listed.find((a) => a.id === firstId);
    expect(entry?.status).toBe("published");
    expect(entry?.collection_name).toBe("English");
    expect(entry).not.toHaveProperty("content");

    // update must not unpublish
    await art("update", { id: firstId, excerpt: "Changed" });
    expect(((await art("get", { id: firstId })) as Record<string, unknown>).status).toBe("published");

    const secondArticle = (await art("create", { collection_id: de.id, title: "Erstattungen", content: "Text", locale: "de" })) as Record<string, unknown>;
    const deId = secondArticle.id as number;
    articleIds.push(deId);

    const linkable = (await art("linkable", { help_center_id: helpCenterId, exclude_locale: "en" })) as { id: number }[];
    expect(linkable.map((a) => a.id)).toContain(deId);
    await art("link_translation", { id: deId, translation_of_id: firstId });
    const withTranslations = (await art("get", { id: firstId })) as { translations: { id: number }[] };
    expect(withTranslations.translations.map((t) => t.id)).toContain(deId);
    await art("unlink_translation", { id: deId });

    await art("move", { id: firstId, collection_id: en2.id });
    const moved = (await art("list", { help_center_id: helpCenterId, collection_id: en2.id })) as Record<string, unknown>[];
    expect(moved.map((a) => a.id)).toEqual([firstId]);

    await art("reorder", { collection_id: en2.id, order: { [firstId]: 5 } });

    const dir = await mkdtemp(join(tmpdir(), "ldesk-sync-"));
    try {
      const file = [
        "---",
        "excerpt: From a file",
        "---",
        "# Synced",
        "",
        "Write to support@example.com or see [docs](https://example.com).",
        "",
        "* one",
        "* two",
        "",
        "| Plan | Price |",
        "| --- | ---: |",
        "| Basic | [5 EUR](https://example.com/basic) |",
        "",
        "- [ ] a task",
        "",
      ];
      await writeFile(join(dir, "synced.md"), file.join("\n"));
      const created = (await art("sync", { path: dir, collection_id: en2.id })) as { created: number; files: { id: number }[] };
      expect(created.created).toBe(1);
      const syncedId = created.files[0]?.id as number;
      articleIds.push(syncedId);
      expect(await readFile(join(dir, "synced.md"), "utf8")).toContain(`id: ${syncedId}`);
      // The server's sanitizer must not make the next run see a change.
      expect(await art("sync", { path: dir })).toMatchObject({ unchanged: 1, updated: 0, failed: 0 });

      const visible = (await art("visibility", { help_center_id: helpCenterId })) as { hidden_articles: { id: number; reasons: string[] }[] };
      expect(visible.hidden_articles.find((a) => a.id === syncedId)?.reasons).toEqual(
        expect.arrayContaining(["status is draft", 'collection "English two" is unpublished']) as unknown,
      );
      await art("delete", { id: syncedId });
      articleIds.splice(articleIds.indexOf(syncedId), 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }

    const bulk = (await art("set_status", { id: [firstId, deId], status: "draft" })) as { ok: number; failed: number };
    expect(bulk).toMatchObject({ ok: 2, failed: 0 });

    // LibreDesk ignores the collection segment of the delete path
    await art("delete", { id: deId });
    await art("delete", { id: firstId });
    articleIds.length = 0;

    for (const id of collectionIds.splice(0)) await hc("collection_delete", { help_center_id: helpCenterId, id });
    await hc("delete", { id: helpCenterId });
    helpCenterId = undefined;
  });
});
