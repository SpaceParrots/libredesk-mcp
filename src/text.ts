/**
 * @module text
 * Makes untrusted text safe to show on a terminal. Server data and client config files can hold
 * escape sequences that move the cursor, erase a line or change the terminal title, so a line
 * the user reads could hide what it says. Those characters are shown as `\xNN` or `\uNNNN`.
 */

/**
 * C0 controls (without tab and newline), DEL, C1 controls, and the bidirectional overrides and
 * isolates that reorder how a line is displayed.
 */
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

function escapeChar(char: string): string {
  const code = char.charCodeAt(0);
  return code <= 0xff ? `\\x${code.toString(16).padStart(2, "0")}` : `\\u${code.toString(16).padStart(4, "0")}`;
}

/** `text` with every terminal control character written as an escape; tabs and newlines stay. */
export function printable(text: string): string {
  return text.replaceAll(CONTROL, escapeChar);
}

/** `text` on one line: like {@link printable}, and tabs and newlines are escaped as well. */
export function printableLine(text: string): string {
  return printable(text).replaceAll("\t", "\\t").replaceAll("\n", "\\n");
}
