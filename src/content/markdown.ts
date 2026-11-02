/**
 * @module content/markdown
 * Conversion between markdown and the HTML LibreDesk stores for knowledge base articles.
 */

import { Marked, Renderer, type Tokens } from "marked";
import { type HTMLElement, NodeType, parse } from "node-html-parser";
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
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "b",
  "em",
  "i",
  "a",
  "ul",
  "ol",
  "li",
  "blockquote",
  "code",
  "pre",
  "br",
  "hr",
  "img",
  "s",
  "del",
]);

const ALLOWED_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  a: ["href", "title"],
  img: ["src", "alt", "title"],
  ol: ["start"],
};

/** Attributes the LibreDesk editor (tiptap Link defaults) puts on every link. */
const LINK_DEFAULTS: Readonly<Record<string, string>> = {
  target: "_blank",
  rel: "noopener noreferrer nofollow",
};

const LINK_ATTRIBUTES = Object.entries(LINK_DEFAULTS)
  .map(([name, value]) => `${name}="${value}"`)
  .join(" ");

const converter = new Marked({
  gfm: true,
  async: false,
  renderer: {
    link(this: Renderer, token: Tokens.Link): string {
      return Renderer.prototype.link
        .call(this, token)
        .replace(/^<a /, `<a ${LINK_ATTRIBUTES} `);
    },
  },
});

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

// Plain text must not turn into tags, entities or strikethrough when marked reads it back.
// A backslash escape does not stop marked's gfm strikethrough, so tildes become a numeric entity.
const defaultEscape = turndown.escape.bind(turndown);
turndown.escape = (text: string): string =>
  defaultEscape(
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/~/g, "&#126;"),
  );

turndown.addRule("strikethrough", {
  filter: ["s", "del"],
  replacement: (content) => `~~${content}~~`,
});

interface ListParent {
  readonly nodeName: string;
  readonly children: unknown;
  getAttribute(name: string): string | null;
}

// Turndown pads list markers to "-   item"; use one space and indent continuation lines by the marker width.
turndown.addRule("compactListItem", {
  filter: "li",
  replacement(content, node, options) {
    const parent = node.parentNode as ListParent | null;
    let prefix = `${options.bulletListMarker} `;
    if (parent?.nodeName === "OL") {
      const start = parent.getAttribute("start");
      const index = Array.prototype.indexOf.call(
        parent.children,
        node,
      ) as number;
      prefix = `${(start ? Number(start) : 1) + index}. `;
    }
    const indent = " ".repeat(prefix.length);
    const body = content
      .replace(/^\n+/, "")
      .replace(/\n+$/, "")
      .split("\n")
      .map((line, index) =>
        line.trim() === "" ? "" : index === 0 ? line : indent + line,
      )
      .join("\n");
    return prefix + body + (node.nextSibling ? "\n" : "");
  },
});

/** Converts GitHub-flavoured markdown to HTML synchronously. */
export function markdownToHtml(markdown: string): string {
  return converter.parse(markdown, { async: false });
}

/** Converts HTML to markdown, trimming surrounding whitespace. */
export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html).trim();
}

function isLanguageClass(value: string): boolean {
  const classes = value.split(/\s+/).filter(Boolean);
  return (
    classes.length > 0 && classes.every((cls) => cls.startsWith("language-"))
  );
}

function hasOnlyText(element: HTMLElement): boolean {
  return (
    element.childNodes.length > 0 &&
    element.childNodes.every((child) => child.nodeType === NodeType.TEXT_NODE)
  );
}

/** A pre block is representable only as a single code element holding plain text. */
function isPlainCodeBlock(pre: HTMLElement): boolean {
  const [child] = pre.childNodes;
  return (
    pre.childNodes.length === 1 &&
    child?.nodeType === NodeType.ELEMENT_NODE &&
    (child as HTMLElement).rawTagName.toLowerCase() === "code" &&
    hasOnlyText(child as HTMLElement)
  );
}

/** Returns the first element or attribute markdown cannot represent, or undefined when none. */
function findUnsupported(html: string): string | undefined {
  // Without pre in the list, node-html-parser parses pre contents as real nodes instead of raw text.
  const root = parse(html, {
    comment: false,
    blockTextElements: { script: true, noscript: true, style: true },
  });
  for (const element of root.querySelectorAll("*")) {
    const tag = element.rawTagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return `<${tag}>`;
    if (tag === "pre" && !isPlainCodeBlock(element)) return "<pre>";
    if (tag === "code" && !hasOnlyText(element)) return "<code>";
    const allowed = ALLOWED_ATTRIBUTES[tag] ?? [];
    for (const [rawName, value] of Object.entries(element.attributes)) {
      const name = rawName.toLowerCase();
      if (tag === "a" && name in LINK_DEFAULTS) {
        if (value === LINK_DEFAULTS[name]) continue;
      } else if (allowed.includes(name)) {
        continue;
      } else if (
        tag === "code" &&
        name === "class" &&
        element.parentNode?.rawTagName?.toLowerCase() === "pre" &&
        isLanguageClass(value)
      ) {
        continue;
      }
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
export function readArticleContent(
  html: string,
  format: ContentFormat,
): ArticleContent {
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
