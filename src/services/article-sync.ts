/**
 * @module services/article-sync
 * Create or update articles from local markdown files. Each file carries its settings in flat
 * frontmatter; after a create, the new article's `id` is written into the file, so the next run
 * updates that article instead of making a second one. An article is only written when a field
 * differs, and sync never changes its status: publishing stays a separate, confirmed step.
 *
 * Only regular files are synced: a `.md` name that is a symbolic link could point anywhere, for
 * example into the home directory from a cloned repo. Over MCP the path must also lie inside a
 * root folder, because a model chooses it.
 */

import { lstat, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ENV } from "../constants.js";
import { canonicalHtml, readArticleContent, toArticleHtml, htmlToMarkdown, markdownToHtml, type ContentFormat } from "../content/markdown.js";
import { parseFrontmatter, setFrontmatterField, type FrontmatterValue } from "../content/frontmatter.js";
import { ARTICLE_KEYS, NO_COLLECTION } from "../domains/article-record.js";
import { InputError, toLibreDeskError } from "../errors.js";
import type { OperationContext } from "../ops/define.js";
import { mergeForUpdate } from "../ops/merge.js";

/** What a sync run is given. */
export interface SyncOptions {
  /** A `.md` file or a folder whose `.md` files are synced (not its subfolders). */
  readonly path: string;
  /** Collection for files without `collection_id` in their frontmatter. */
  readonly collectionId?: number;
  /** Report what would change without writing anything, on the server or to the files. */
  readonly dryRun: boolean;
  /** When set, `path` must lie inside this folder, after symbolic links are resolved. */
  readonly root?: string;
  /**
   * Fail a file whose `collection_id` would move its article. Set over MCP: a move can make an
   * article public, so it belongs to the publish tool, not to sync.
   */
  readonly refuseMoves?: boolean;
}

/** File access, replaceable in tests. */
export interface SyncFs {
  readonly readFile: (path: string) => Promise<string>;
  readonly writeFile: (path: string, text: string) => Promise<void>;
  readonly readdir: (path: string) => Promise<string[]>;
  readonly isDirectory: (path: string) => Promise<boolean>;
  /** Whether the path itself, not what a link points to, is a regular file. */
  readonly isRegularFile: (path: string) => Promise<boolean>;
  /** The path with every symbolic link resolved. */
  readonly realpath: (path: string) => Promise<string>;
}

/** What happened to one file. */
export interface SyncFileResult {
  readonly file: string;
  readonly action: "created" | "updated" | "moved" | "unchanged" | "would create" | "would update" | "failed";
  readonly id?: number;
  /** Fields that differed, for an update. */
  readonly changed?: readonly string[];
  readonly error?: string;
}

/** The result of a sync run: counts, then one entry per file. */
export interface SyncResult {
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly failed: number;
  readonly files: readonly SyncFileResult[];
}

const NODE_FS: SyncFs = {
  readFile: (path) => readFile(path, "utf8"),
  writeFile: (path, text) => writeFile(path, text, "utf8"),
  readdir: (path) => readdir(path),
  isDirectory: async (path) => (await stat(path)).isDirectory(),
  isRegularFile: async (path) => (await lstat(path)).isFile(),
  realpath: (path) => realpath(path),
};

/** The folder `articles sync` may read when a model chooses the path: `LIBREDESK_SYNC_ROOT`, else the working directory. */
export function mcpSyncRoot(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string {
  const root = env[ENV.SYNC_ROOT];
  return root === undefined || root === "" ? cwd : resolve(cwd, root);
}

/** Throw unless `path`, with links resolved, is `root` or inside it. */
async function assertInside(path: string, root: string, fs: SyncFs): Promise<void> {
  const [real, base] = await Promise.all([fs.realpath(path), fs.realpath(root)]);
  const rel = relative(base, real);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new InputError(`${path} is outside ${base}. Sync over MCP only reads files below that folder; set ${ENV.SYNC_ROOT} for the MCP server to allow another one.`);
  }
}

const NUMBER_KEYS = ["id", "collection_id", "sort_order"] as const;
const STRING_KEYS = ["title", "excerpt", "locale", "meta_title", "meta_description", "meta_image_url", "format"] as const;
const BOOLEAN_KEYS = ["ai_enabled"] as const;

/** Frontmatter keys sync reads. Anything else is an error, so a typo or a `status` line is not silently ignored. */
export const SYNC_KEYS: readonly string[] = [...NUMBER_KEYS, ...STRING_KEYS, ...BOOLEAN_KEYS];

/** Optional article fields copied from the frontmatter when present. */
const SETTING_KEYS = ["excerpt", "locale", "meta_title", "meta_description", "meta_image_url", "sort_order", "ai_enabled"] as const;

interface LocalArticle {
  readonly id?: number;
  readonly collectionId?: number;
  readonly title: string;
  readonly content: string;
  readonly format: ContentFormat;
  readonly settings: Readonly<Record<string, FrontmatterValue>>;
}

function checkTypes(data: Readonly<Record<string, FrontmatterValue>>): void {
  const unknown = Object.keys(data).filter((key) => !SYNC_KEYS.includes(key));
  if (unknown.length > 0) {
    const status = unknown.includes("status") ? " Sync never publishes; set the status with set_status afterwards." : "";
    throw new InputError(`unknown frontmatter ${unknown.join(", ")}.${status} Known: ${SYNC_KEYS.join(", ")}.`);
  }
  for (const key of NUMBER_KEYS) if (key in data && !Number.isSafeInteger(data[key])) throw new InputError(`frontmatter ${key} must be a whole number`);
  for (const key of ["id", "collection_id"] as const) if (key in data && (data[key] as number) <= 0) throw new InputError(`frontmatter ${key} must be greater than 0`);
  for (const key of BOOLEAN_KEYS) if (key in data && typeof data[key] !== "boolean") throw new InputError(`frontmatter ${key} must be true or false`);
  if ("format" in data && data.format !== "markdown" && data.format !== "html") throw new InputError('frontmatter format must be "markdown" or "html"');
}

/** Read a file's article: title from the frontmatter, else from a leading `# heading`, which then leaves the body. */
export function readLocalArticle(text: string): LocalArticle {
  const { data, body } = parseFrontmatter(text);
  checkTypes(data);
  const strings = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, (STRING_KEYS as readonly string[]).includes(key) ? String(value) : value]));
  let title = typeof strings.title === "string" ? strings.title : undefined;
  let content = body;
  if (title === undefined) {
    const heading = /^\s*# +(.+?)[ \t]*(?:\r?\n|$)/.exec(body);
    if (heading) {
      title = heading[1];
      content = body.slice(heading[0].length);
    }
  }
  if (!title) throw new InputError("no title: add title to the frontmatter or start the body with a # heading");
  const settings = Object.fromEntries(SETTING_KEYS.filter((key) => key in strings).map((key) => [key, strings[key] as FrontmatterValue]));
  return {
    id: typeof data.id === "number" ? data.id : undefined,
    collectionId: typeof data.collection_id === "number" ? data.collection_id : undefined,
    title,
    content: content.trim(),
    format: data.format === "html" ? "html" : "markdown",
    settings,
  };
}

/** Content in the form both sides reach after a markdown round trip, so formatting alone is no change. */
function canonical(content: string, format: ContentFormat): string {
  return format === "markdown" ? htmlToMarkdown(markdownToHtml(content)) : content.trim();
}

/**
 * Whether the stored HTML already says what the file says. Markdown that reads back as markdown is
 * compared as markdown; anything else (tables, task lists, html files) as canonical HTML, so
 * the attributes LibreDesk's sanitizer adds do not count as a change.
 */
function sameContent(local: LocalArticle, stored: string): boolean {
  if (local.format === "markdown") {
    const read = readArticleContent(stored, "markdown");
    if (read.content_format === "markdown" && canonical(read.content, "markdown") === canonical(local.content, "markdown")) return true;
  }
  return canonicalHtml(stored) === canonicalHtml(toArticleHtml(local.content, local.format));
}

/** The fields of `local` that differ from the server's `current` article. */
export function changedFields(local: LocalArticle, current: Readonly<Record<string, unknown>>): string[] {
  const changed: string[] = [];
  if (local.title !== current.title) changed.push("title");
  const stored = typeof current.content === "string" ? current.content : "";
  if (!sameContent(local, stored)) changed.push("content");
  for (const [key, value] of Object.entries(local.settings)) if (current[key] !== value) changed.push(key);
  return changed;
}

async function listFiles(path: string, fs: SyncFs): Promise<string[]> {
  if (await fs.isDirectory(path)) {
    const names = (await fs.readdir(path)).filter((name) => extname(name).toLowerCase() === ".md").sort();
    return names.map((name) => join(path, name));
  }
  if (extname(path).toLowerCase() !== ".md") throw new InputError(`${path} is not a .md file or a folder`);
  return [path];
}

async function syncFile(file: string, local: LocalArticle, text: string, options: SyncOptions, ctx: OperationContext, fs: SyncFs): Promise<SyncFileResult> {
  const name = basename(file);
  const html = toArticleHtml(local.content, local.format);
  if (local.id === undefined) {
    const collection = local.collectionId ?? options.collectionId;
    if (collection === undefined) throw new InputError("no collection: add collection_id to the frontmatter or pass collection_id");
    if (options.dryRun) return { file: name, action: "would create" };
    const body = { ai_enabled: true, ...local.settings, title: local.title, content: html, status: "draft" };
    const created = await ctx.call<{ id?: unknown }>("POST", `/api/v1/collections/${collection}/articles`, { body });
    const id = typeof created?.id === "number" ? created.id : undefined;
    if (id === undefined) throw new Error("LibreDesk returned no id for the new article");
    try {
      await fs.writeFile(file, setFrontmatterField(text, "id", id));
    } catch (error) {
      throw new Error(`created article ${id} but could not write its id into the file (${toLibreDeskError(error).message}); add "id: ${id}" by hand before the next run`);
    }
    return { file: name, action: "created", id };
  }
  const current = await ctx.call<Record<string, unknown>>("GET", `/api/v1/collections/${NO_COLLECTION}/articles/${local.id}`);
  const changed = changedFields(local, current);
  const move = local.collectionId !== undefined && local.collectionId !== current.collection_id;
  if (move && options.refuseMoves === true) {
    throw new InputError(`collection_id ${local.collectionId} would move article ${local.id} from collection ${String(current.collection_id)}; sync over MCP does not move articles, use article_move of libredesk_publish`);
  }
  if (move) changed.push("collection_id");
  if (changed.length === 0) return { file: name, action: "unchanged", id: local.id };
  if (options.dryRun) return { file: name, action: "would update", id: local.id, changed };
  if (changed.some((field) => field !== "collection_id")) {
    const body = mergeForUpdate(current, { ...local.settings, title: local.title, content: html }, ARTICLE_KEYS);
    await ctx.call("PUT", `/api/v1/articles/${local.id}`, { body });
  }
  if (move) await ctx.call("PUT", `/api/v1/articles/${local.id}/collection`, { body: { collection_id: local.collectionId } });
  return { file: name, action: changed.length === 1 && move ? "moved" : "updated", id: local.id, changed };
}

/**
 * Sync the `.md` files at `options.path` to LibreDesk, one file after the other. A failing file is
 * reported and the others still run. Two files with the same `id` fail rather than overwrite each other.
 */
export async function syncArticles(options: SyncOptions, ctx: OperationContext, fs: SyncFs = NODE_FS): Promise<SyncResult> {
  const target = resolve(options.path);
  if (options.root !== undefined) await assertInside(target, options.root, fs);
  const files = await listFiles(target, fs);
  const results: SyncFileResult[] = [];
  const seen = new Map<number, string>();
  for (const file of files) {
    try {
      // A regular file in a folder already inside the root stays inside it.
      if (!(await fs.isRegularFile(file))) throw new InputError("not a regular file; symbolic links are not synced");
      const text = await fs.readFile(file);
      const local = readLocalArticle(text);
      if (local.id !== undefined) {
        const other = seen.get(local.id);
        if (other !== undefined) throw new InputError(`id ${local.id} is also in ${other}`);
        seen.set(local.id, basename(file));
      }
      results.push(await syncFile(file, local, text, options, ctx, fs));
    } catch (error) {
      results.push({ file: basename(file), action: "failed", error: toLibreDeskError(error).message });
    }
  }
  const count = (...actions: SyncFileResult["action"][]) => results.filter((r) => actions.includes(r.action)).length;
  return {
    created: count("created", "would create"),
    updated: count("updated", "moved", "would update"),
    unchanged: count("unchanged"),
    failed: count("failed"),
    files: results,
  };
}
