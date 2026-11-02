import { describe, expect, it } from "vitest";
import { mergeForUpdate } from "../../src/ops/merge.js";

describe("mergeForUpdate", () => {
  it("keeps current values for keys not in changes", () => {
    expect(mergeForUpdate({ title: "a", ai_enabled: true, views: 9 }, { title: "b" }, ["title", "ai_enabled"])).toEqual({
      title: "b",
      ai_enabled: true,
    });
  });

  it("lets an explicit false override true", () => {
    expect(mergeForUpdate({ title: "a", ai_enabled: true }, { ai_enabled: false }, ["title", "ai_enabled"])).toEqual({
      title: "a",
      ai_enabled: false,
    });
  });

  it("treats undefined changes as absent and ignores keys outside allowed", () => {
    const current = { title: "a", status: "draft" };
    const merged = mergeForUpdate(current, { title: undefined, status: "published", extra: 1 }, ["title", "status"]);
    expect(merged).toEqual({ title: "a", status: "published" });
    expect(Object.keys(merged)).toEqual(["title", "status"]);
    expect(current).toEqual({ title: "a", status: "draft" });
  });
});
