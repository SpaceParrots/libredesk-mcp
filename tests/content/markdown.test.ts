import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  htmlToMarkdown,
  isMarkdownSafe,
  markdownToHtml,
  readArticleContent,
  toArticleHtml,
} from "../../src/content/markdown.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/articles/${name}.html`, import.meta.url), "utf8");

describe("isMarkdownSafe", () => {
  it("accepts the simple and code fixtures", () => {
    expect(isMarkdownSafe(fixture("simple"))).toBe(true);
    expect(isMarkdownSafe(fixture("code"))).toBe(true);
  });

  it.each(["table", "youtube", "styled", "image-attrs"])("rejects the %s fixture", (name) => {
    expect(isMarkdownSafe(fixture(name))).toBe(false);
  });

  it("matches tag and attribute names case-insensitively", () => {
    expect(isMarkdownSafe('<P>x <A HREF="/a">y</A></P>')).toBe(true);
    expect(isMarkdownSafe('<P STYLE="x">y</P>')).toBe(false);
  });

  it("allows comments and text nodes", () => {
    expect(isMarkdownSafe("loose <!-- note --> text")).toBe(true);
  });

  it("rejects non-language code classes and span", () => {
    expect(isMarkdownSafe('<code class="hljs">x</code>')).toBe(false);
    expect(isMarkdownSafe("<p><span>x</span></p>")).toBe(false);
  });
});

describe("readArticleContent", () => {
  it("returns markdown for safe html", () => {
    expect(readArticleContent("<h2>Refunds</h2><p>Within <strong>30</strong> days.</p>", "markdown")).toEqual({
      content: "## Refunds\n\nWithin **30** days.",
      content_format: "markdown",
    });
  });

  it("falls back to html naming the offending element", () => {
    const out = readArticleContent(fixture("table"), "markdown");
    expect(out.content_format).toBe("html");
    expect(out.content).toBe(fixture("table"));
    expect(out.note).toBe(
      'Returned as HTML because it contains <table> which markdown cannot represent. Edit and send it back with format "html".',
    );
  });

  it("names the element and attribute for an offending attribute", () => {
    expect(readArticleContent(fixture("image-attrs"), "markdown").note).toMatch(/<img width>/);
  });

  it("returns html input untouched when html is requested", () => {
    const html = fixture("styled");
    expect(readArticleContent(html, "html")).toEqual({ content: html, content_format: "html" });
  });

  it("converts the code fixture to fenced blocks", () => {
    const out = readArticleContent(fixture("code"), "markdown");
    expect(out.content).toContain("```bash\nnpm install -g @spaceparrots/libredesk-mcp\nldesk --help\n```");
  });
});

describe("toArticleHtml", () => {
  it("converts markdown and passes html through", () => {
    expect(toArticleHtml("# Hi", "markdown")).toBe("<h1>Hi</h1>\n");
    expect(toArticleHtml("<p>x</p>", "html")).toBe("<p>x</p>");
  });
});

describe("round trip", () => {
  it("markdown -> html -> markdown is stable", () => {
    const md = [
      "## Refunds",
      "",
      "Within **30** days, see [policy](https://example.com/p).",
      "",
      "- one",
      "- two",
      "",
      "```bash",
      "ldesk --help",
      "```",
    ].join("\n");
    const html = markdownToHtml(md);
    expect(isMarkdownSafe(html)).toBe(true);
    expect(htmlToMarkdown(html)).toBe(md);
  });
});
