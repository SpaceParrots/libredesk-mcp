import { readFileSync } from "node:fs";
import { parse } from "node-html-parser";
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

const roundTrip = (md: string): string => htmlToMarkdown(markdownToHtml(md));

describe("pre handling", () => {
  it.each([
    '<pre><code class="language-js"><span class="k" onclick="x">a</span></code></pre>',
    "<pre><img src=x onerror=1></pre>",
    "<pre>plain preformatted</pre>",
    "<pre><code>a</code><code>b</code></pre>",
    "<pre><code>a<b>bold</b></code></pre>",
  ])("rejects %s", (html) => {
    expect(isMarkdownSafe(html)).toBe(false);
  });

  it("accepts pre with a single code text child", () => {
    expect(isMarkdownSafe('<pre><code class="language-js">a &lt; b</code></pre>')).toBe(true);
  });
});

describe("strikethrough", () => {
  it("converts s and del and round-trips", () => {
    expect(htmlToMarkdown("<p>x <s>old</s> <del>d</del></p>")).toBe("x ~~old~~ ~~d~~");
    expect(roundTrip("x ~~old~~ y")).toBe("x ~~old~~ y");
  });
});

describe("lists", () => {
  it("round-trips nested unordered lists", () => {
    expect(roundTrip("- a\n  - b\n    - c\n- d")).toBe("- a\n  - b\n    - c\n- d");
  });

  it("round-trips nested ordered lists", () => {
    expect(roundTrip("1. a\n   1. b\n   2. c\n2. d")).toBe("1. a\n   1. b\n   2. c\n2. d");
  });

  it("round-trips mixed lists", () => {
    expect(roundTrip("1. a\n   - b\n   - c\n2. d")).toBe("1. a\n   - b\n   - c\n2. d");
  });

  it("never emits whitespace-only lines for tiptap-style nested lists", () => {
    const md = htmlToMarkdown("<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>");
    expect(md).not.toMatch(/^[ \t]+$/m);
    expect(md).toContain("- b");
    expect(htmlToMarkdown(markdownToHtml(md))).toBe(md);
  });

  it("keeps the ol start number", () => {
    expect(roundTrip("3. a\n4. b")).toBe("3. a\n4. b");
  });
});

describe("escaping", () => {
  it("keeps literal angle brackets and ampersands as text", () => {
    const md = htmlToMarkdown("<p>a &lt;b&gt; &amp; c</p>");
    const html = markdownToHtml(md);
    expect(html).toBe("<p>a &lt;b&gt; &amp; c</p>\n");
    expect(isMarkdownSafe(html)).toBe(true);
  });
});

describe("links", () => {
  const defaults = 'target="_blank" rel="noopener noreferrer nofollow"';

  it("adds the editor's default target and rel to every emitted link", () => {
    expect(markdownToHtml("[x](https://e.com)")).toContain(defaults);
    expect(markdownToHtml("<https://e.com>")).toContain(defaults);
  });

  it("round-trips a default link exactly", () => {
    const html = `<p><a href="https://e.com" ${defaults}>x</a></p>`;
    expect(isMarkdownSafe(html)).toBe(true);
    expect(readArticleContent(html, "markdown").content).toBe("[x](https://e.com)");
    expect(toArticleHtml("[x](https://e.com)", "markdown")).toContain(`<a ${defaults} href="https://e.com">x</a>`);
  });

  it("falls back to html for a non-default target or rel", () => {
    expect(readArticleContent('<p><a href="/a" target="_self">x</a></p>', "markdown").note).toMatch(/<a target>/);
    expect(readArticleContent('<p><a href="/a" rel="sponsored">x</a></p>', "markdown").note).toMatch(/<a rel>/);
  });
});

describe("other round trips", () => {
  it("keeps br, image titles and exact simple fixture markdown", () => {
    expect(htmlToMarkdown("<p>a<br>b</p>")).toBe("a  \nb");
    expect(roundTrip('![alt](/i.png "Title")')).toBe('![alt](/i.png "Title")');
    expect(readArticleContent(fixture("simple"), "markdown").content).toBe(
      [
        "## Refunds",
        "",
        "Orders can be returned within **30** days. See the [refund policy](https://example.com/policy \"Policy\").",
        "",
        "- Keep the receipt",
        "- Use the _original_ packaging",
        "",
        "3. Contact support",
        "4. Ship the parcel",
        "",
        "> Refunds take up to 5 days.",
        "",
        "* * *",
        "",
        "Line one  ",
        "Line two with ~~old~~ text and `inline` code.",
      ].join("\n"),
    );
  });

  const structure = (html: string): { text: string; tags: string[] } => {
    const root = parse(html);
    const tags = root
      .querySelectorAll("*")
      .filter((el) => !(el.rawTagName.toLowerCase() === "p" && el.parentNode?.rawTagName?.toLowerCase() === "li"))
      .map((el) => el.rawTagName.toLowerCase().replace("del", "s").replace(/^b$/, "strong").replace(/^i$/, "em"))
      .sort();
    return { text: root.textContent.replace(/\s+/g, ""), tags };
  };

  it.each(["simple", "code"])("%s fixture keeps text and tags through markdown", (name) => {
    const html = fixture(name);
    const back = toArticleHtml(readArticleContent(html, "markdown").content, "markdown");
    expect(structure(back)).toEqual(structure(html));
  });
});
