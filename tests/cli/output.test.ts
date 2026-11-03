import { describe, expect, it } from "vitest";
import { handleCliError, printResult } from "../../src/cli/output.js";
import { CancelledError, LibreDeskError } from "../../src/errors.js";

function capture(fn: (write: (s: string) => void) => void): string {
  let out = "";
  fn((s) => {
    out += s;
  });
  return out;
}

describe("printResult", () => {
  it("masks secrets in table, object and json output", () => {
    const secret = { name: "a", api_secret: "secretvalue1234" };
    const table = capture((w) => printResult([secret], { json: false }, w));
    const object = capture((w) => printResult(secret, { json: false }, w));
    const json = capture((w) => printResult({ rows: [secret] }, { json: true }, w));
    for (const out of [table, object, json]) expect(out).not.toContain("secretvalue");
  });

  it("prints arrays as tables with at most 6 scalar columns", () => {
    const row = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, nested: { x: 1 } };
    const out = capture((w) => printResult([row, row], { json: false }, w));
    const header = out.split("\n")[0] ?? "";
    expect(header.trim().split(/\s+/)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(out).toContain("2 rows");
    expect(out).not.toContain("nested");
  });

  it("escapes terminal control characters from server text in text mode, not in json mode", () => {
    const evil = { title: "ok\u001b]0;pwned\u0007" };
    expect(capture((w) => printResult(evil, { json: false }, w))).toBe("title: ok\\x1b]0;pwned\\x07\n");
    expect(JSON.parse(capture((w) => printResult(evil, { json: true }, w)))).toEqual(evil);
  });

  it("prints objects as key: value lines, strings as is, json pretty", () => {
    expect(capture((w) => printResult({ id: 1, tags: ["a"] }, { json: false }, w))).toBe('id: 1\ntags: ["a"]\n');
    expect(capture((w) => printResult("hello", { json: false }, w))).toBe("hello\n");
    expect(capture((w) => printResult({ a: 1 }, { json: true }, w))).toBe('{\n  "a": 1\n}\n');
  });
});

describe("handleCliError", () => {
  function run(err: unknown): { out: string; code: number } {
    let out = "";
    let code = -1;
    try {
      handleCliError(
        err,
        (c) => {
          code = c;
          throw new Error("exit");
        },
        (s) => {
          out += s;
        },
      );
    } catch {
      // exit stub
    }
    return { out, code };
  }

  it("prints message and hint, never the cause", () => {
    const cause = new SyntaxError('{"api_secret":"topsecretvalue"}');
    const { out, code } = run(new LibreDeskError("Bad config.", { hint: "Fix it.", cause }));
    expect(out).toBe("Error: Bad config.\nHint: Fix it.\n");
    expect(out).not.toContain("topsecret");
    expect(code).toBe(1);
  });

  it("exits 130 on cancel", () => {
    expect(run(new CancelledError()).code).toBe(130);
  });
});
