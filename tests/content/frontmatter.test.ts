import { describe, expect, it } from "vitest";
import { parseFrontmatter, setFrontmatterField } from "../../src/content/frontmatter.js";

describe("parseFrontmatter", () => {
  it("reads strings, quoted strings, numbers and booleans, and skips comments and blank lines", () => {
    const doc = parseFrontmatter('---\ntitle: Wie ändere ich: die Adresse\n# a comment\n\nexcerpt: "42"\nsort_order: 3\nai_enabled: false\n---\nBody\n');
    expect(doc.data).toEqual({ title: "Wie ändere ich: die Adresse", excerpt: "42", sort_order: 3, ai_enabled: false });
    expect(doc.body).toBe("Body\n");
  });

  it("treats a file without a leading fence as all body", () => {
    expect(parseFrontmatter("# Title\n\ntext")).toEqual({ data: {}, body: "# Title\n\ntext" });
  });

  it("handles CRLF and a BOM", () => {
    expect(parseFrontmatter("﻿---\r\nid: 7\r\n---\r\nBody")).toEqual({ data: { id: 7 }, body: "Body" });
  });

  it("rejects nested YAML and repeated keys instead of misreading them", () => {
    expect(() => parseFrontmatter("---\ntags:\n  - a\n---\n")).toThrow(/line 3/);
    expect(() => parseFrontmatter("---\nid: 1\nid: 2\n---\n")).toThrow(/id twice/);
  });
});

describe("setFrontmatterField", () => {
  it("adds the field as the first one and keeps every other byte", () => {
    const text = "---\ntitle: T\n---\n\nBody with --- inside\n";
    expect(setFrontmatterField(text, "id", 12)).toBe("---\nid: 12\ntitle: T\n---\n\nBody with --- inside\n");
  });

  it("replaces an existing field in place", () => {
    expect(setFrontmatterField("---\ntitle: T\nid: 3\n---\nB", "id", 12)).toBe("---\ntitle: T\nid: 12\n---\nB");
  });

  it("adds a frontmatter block when there is none, keeping CRLF and the BOM", () => {
    expect(setFrontmatterField("﻿# T\r\nBody", "id", 5)).toBe("﻿---\r\nid: 5\r\n---\r\n# T\r\nBody");
  });

  it("round-trips through parseFrontmatter", () => {
    const written = setFrontmatterField("---\ntitle: T\n---\nBody", "id", 9);
    expect(parseFrontmatter(written)).toEqual({ data: { id: 9, title: "T" }, body: "Body" });
  });
});
