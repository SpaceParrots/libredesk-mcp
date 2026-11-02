/**
 * @module content/markdown
 * Conversion between markdown and the HTML LibreDesk stores for knowledge base articles.
 */

import { marked } from "marked";
import { parse } from "node-html-parser";
import TurndownService from "turndown";

/** How article content is written or read by callers. */
export type ContentFormat = "markdown" | "html";

/** Article content as returned to a caller, with the format actually used. */
export interface ArticleContent {
  readonly content: string;
  readonly content_format: ContentFormat;
  readonly note?: string;
}

const ALLOWED_TAGS: ReadonlySet<string> = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "em", "i", "a", "ul", "ol", "li",
  "blockquote", "code", "pre", "br", "hr", "img", "s", "del",
]);

const ALLOWED_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  a: ["href", "title", "target", "rel"],
  img: ["src", "alt", "title"],
  ol: ["start"],
};

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

interface ListParent {
  readonly nodeName: string;
  readonly children: unknown;
  getAttribute(name: string): string | null;
}

// Turndown pads list markers to "-   item"; use a single space like hand-written markdown.
turndown.addRule("compactListItem", {
  filter: "li",
  replacement(content, node, options) {
    const body = content
      .replace(/^\n+/, "")
      .replace(/\n+$/, "\n")
      .replace(/\n/g, "\n  ");
    const parent = node.parentNode as ListParent | null;
    let prefix = `${options.bulletListMarker} `;
    if (parent?.nodeName === "OL") {
      const start = parent.getAttribute("start");
      const index = Array.prototype.indexOf.call(parent.children, node) as number;
      prefix = `${(start ? Number(start) : 1) + index}. `;
    }
    return prefix + body + (node.nextSibling && !body.endsWith("\n") ? "\n" : "");
  },
});

/** Converts GitHub-flavoured markdown to HTML synchronously. */
export function markdownToHtml(markdown: string): string {
  return marked.parse(markdown, { async: false, gfm: true });
}

/** Converts HTML to markdown, trimming surrounding whitespace. */
export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html).trim();
}

function isLanguageClass(value: string): boolean {
  const classes = value.split(/\s+/).filter(Boolean);
  return classes.length > 0 && classes.every((cls) => cls.startsWith("language-"));
}

/** Returns the first element or attribute markdown cannot represent, or undefined when none. */
function findUnsupported(html: string): string | undefined {
  const root = parse(html, { comment: false });
  for (const element of root.querySelectorAll("*")) {
    const tag = element.rawTagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return `<${tag}>`;
    const allowed = ALLOWED_ATTRIBUTES[tag] ?? [];
    for (const [rawName, value] of Object.entries(element.attributes)) {
      const name = rawName.toLowerCase();
      if (allowed.includes(name)) continue;
      if (tag === "code" && name === "class" && isLanguageClass(value)) continue;
      return `<${tag} ${name}>`;
    }
  }
  return undefined;
}

/** True when the HTML only uses elements and attributes that survive a markdown round trip. */
export function isMarkdownSafe(html: string): boolean {
  return findUnsupported(html) === undefined;
}

/** Prepares caller content for storage: markdown becomes HTML, HTML passes through. */
export function toArticleHtml(content: string, format: ContentFormat): string {
  return format === "markdown" ? markdownToHtml(content) : content;
}

/** Prepares stored HTML for a caller, falling back to HTML with a note when markdown would lose markup. */
export function readArticleContent(html: string, format: ContentFormat): ArticleContent {
  if (format === "html") return { content: html, content_format: "html" };
  const unsupported = findUnsupported(html);
  if (unsupported === undefined) {
    return { content: htmlToMarkdown(html), content_format: "markdown" };
  }
  return {
    content: html,
    content_format: "html",
    note: `Returned as HTML because it contains ${unsupported} which markdown cannot represent. Edit and send it back with format "html".`,
  };
}
