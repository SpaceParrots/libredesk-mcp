/**
 * @module cli/output
 * Printing results and errors. Everything is masked before it is written, and the writers are
 * injectable so tests can capture output without touching the console.
 */

import { toLibreDeskError } from "../errors.js";
import { maskSecrets } from "../mask.js";

/** Writes a chunk of text to a stream. */
export type Writer = (text: string) => void;

const stdout: Writer = (text) => void process.stdout.write(text);
const stderr: Writer = (text) => void process.stderr.write(text);

/** Exit code for a failed command. */
export const EXIT_ERROR = 1;
/** Exit code for a cancelled prompt (SIGINT convention). */
export const EXIT_CANCELLED = 130;

const MAX_COLUMNS = 6;
const MAX_CELL = 40;

function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value).replaceAll(/\s+/g, " ");
  return text.length > MAX_CELL ? `${text.slice(0, MAX_CELL - 3)}...` : text;
}

function compact(value: unknown): string {
  if (isScalar(value)) return value === null ? "null" : String(value);
  return JSON.stringify(value) ?? "";
}

function tableColumns(rows: readonly Record<string, unknown>[]): string[] {
  const columns: string[] = [];
  const rejected = new Set<string>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (value === undefined) continue;
      if (!isScalar(value)) rejected.add(key);
      else if (!columns.includes(key)) columns.push(key);
    }
  }
  return columns.filter((key) => !rejected.has(key)).slice(0, MAX_COLUMNS);
}

function renderTable(rows: readonly Record<string, unknown>[]): string {
  const count = `${rows.length} ${rows.length === 1 ? "row" : "rows"}`;
  const columns = tableColumns(rows);
  if (columns.length === 0) return count;
  const cells = rows.map((row) => columns.map((key) => cell(row[key])));
  const widths = columns.map((key, i) => Math.max(key.length, ...cells.map((line) => line[i]?.length ?? 0)));
  const line = (parts: readonly string[]) => parts.map((part, i) => part.padEnd(widths[i] ?? 0)).join("  ").trimEnd();
  return [line(columns), line(widths.map((w) => "-".repeat(w))), ...cells.map(line), count].join("\n");
}

function render(data: unknown): string {
  if (data === undefined) return "";
  if (typeof data === "string") return data;
  if (Array.isArray(data)) {
    if (data.length > 0 && data.every(isRecord)) return renderTable(data);
    if (data.length === 0) return "0 rows";
    return data.map(compact).join("\n");
  }
  if (isRecord(data)) return Object.entries(data).map(([key, value]) => `${key}: ${compact(value)}`).join("\n");
  return compact(data);
}

/**
 * Print a command result to stdout after masking secrets. `json` prints the masked data as
 * pretty JSON; otherwise arrays of objects become a table, objects `key: value` lines.
 */
export function printResult(data: unknown, opts: { json: boolean }, write: Writer = stdout): void {
  const masked = maskSecrets(data);
  const text = opts.json ? (JSON.stringify(masked, null, 2) ?? "") : render(masked);
  if (text !== "") write(`${text}\n`);
}

/** Print a success message to stdout. */
export function printSuccess(msg: string, write: Writer = stdout): void {
  write(`${msg}\n`);
}

/** Print an informational message to stderr, so it never mixes into piped results. */
export function printInfo(msg: string, write: Writer = stderr): void {
  write(`${msg}\n`);
}

/**
 * Print an error to stderr and exit: code 1, or 130 for a cancelled prompt. Only the message
 * and the hint are printed, never the cause or a stack trace, because a cause can carry file
 * contents that include secrets.
 */
export function handleCliError(
  err: unknown,
  exit: (code: number) => never = (code) => process.exit(code),
  write: Writer = stderr,
): never {
  const error = toLibreDeskError(err);
  if (error.code === "CANCELLED") {
    write(`${error.message}\n`);
    return exit(EXIT_CANCELLED);
  }
  write(`Error: ${error.message}\n`);
  if (error.hint) write(`Hint: ${error.hint}\n`);
  return exit(EXIT_ERROR);
}
