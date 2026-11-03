import { describe, expect, it } from "vitest";
import { printable, printableLine } from "../src/text.js";

describe("printable", () => {
  it("escapes terminal control characters and keeps text, tabs and newlines", () => {
    expect(printable("a\u001b[31mred\u0007\tb\nc")).toBe("a\\x1b[31mred\\x07\tb\nc");
    expect(printable("x\u009by\u007f")).toBe("x\\x9by\\x7f");
    expect(printable("ä ü 日本")).toBe("ä ü 日本");
  });

  it("escapes bidi overrides that reorder what the reader sees", () => {
    expect(printable("a‮b⁦c")).toBe("a\\u202eb\\u2066c");
  });
});

describe("printableLine", () => {
  it("also escapes tabs and newlines, so a value stays on one line", () => {
    expect(printableLine("a\tb\nc\rd")).toBe("a\\tb\\nc\\x0dd");
  });
});
