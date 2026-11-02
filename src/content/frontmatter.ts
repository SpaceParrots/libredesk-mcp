/**
 * @module content/frontmatter
 * Flat frontmatter at the top of a markdown file: `key: value` lines between two `---` lines.
 * Values are strings, numbers or booleans; nested YAML is rejected rather than misread. Writing a
 * field changes only its own line, so the rest of the file stays byte for byte.
 */

/** A frontmatter value. */
export type FrontmatterValue = string | number | boolean;

/** A markdown file split into its frontmatter and body. */
export interface FrontmatterDoc {
  readonly data: Readonly<Record<string, FrontmatterValue>>;
  readonly body: string;
}

const BOM = "﻿";
const FENCE = /^---[ \t]*$/;
const FIELD = /^([A-Za-z_][\w-]*)[ \t]*:[ \t]*(.*?)[ \t]*$/;

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

function parseValue(raw: string): FrontmatterValue {
  const quoted = /^"(.*)"$/.exec(raw) ?? /^'(.*)'$/.exec(raw);
  if (quoted) return quoted[1] ?? "";
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  return raw;
}

/** The index of the closing fence, or -1 when the text has no frontmatter. */
function closingFence(lines: readonly string[]): number {
  if (!FENCE.test(lines[0] ?? "")) return -1;
  return lines.findIndex((line, index) => index > 0 && FENCE.test(line));
}

/** Split `text` into frontmatter and body. Throws on a line that is not `key: value`, a comment or blank. */
export function parseFrontmatter(text: string): FrontmatterDoc {
  const lines = splitLines(text.startsWith(BOM) ? text.slice(1) : text);
  const end = closingFence(lines);
  if (end < 0) return { data: {}, body: lines.join("\n") };
  // No prototype, so a `__proto__` line is an ordinary key that callers see and can reject.
  const data = Object.create(null) as Record<string, FrontmatterValue>;
  for (const [offset, line] of lines.slice(1, end).entries()) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const match = FIELD.exec(line);
    if (!match || /^\s/.test(line)) throw new Error(`frontmatter line ${offset + 2} is not "key: value": ${line.trim()}`);
    const [, key = "", value = ""] = match;
    if (Object.hasOwn(data, key)) throw new Error(`frontmatter has ${key} twice`);
    data[key] = parseValue(value);
  }
  return { data, body: lines.slice(end + 1).join("\n") };
}

/**
 * Set `key: value` in the frontmatter of `text`: replace the key's line, or add it as the first
 * field, or add a frontmatter block when there is none. Line endings and a BOM are kept.
 */
export function setFrontmatterField(text: string, key: string, value: number | string): string {
  const bom = text.startsWith(BOM) ? BOM : "";
  const rest = bom ? text.slice(1) : text;
  const eol = rest.includes("\r\n") ? "\r\n" : "\n";
  const line = `${key}: ${value}`;
  const lines = rest.split(/\r?\n/);
  const end = closingFence(lines);
  if (end < 0) return `${bom}---${eol}${line}${eol}---${eol}${rest}`;
  const existing = lines.findIndex((l, index) => index > 0 && index < end && FIELD.exec(l)?.[1] === key);
  const next = existing >= 0 ? lines.map((l, index) => (index === existing ? line : l)) : [lines[0] ?? "---", line, ...lines.slice(1)];
  return bom + next.join(eol);
}
