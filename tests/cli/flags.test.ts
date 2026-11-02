import { describe, expect, it } from "vitest";
import { flagsFor, parseFlagValues } from "../../src/cli/flags.js";
import { InputError } from "../../src/errors.js";
import { sample } from "./helpers.js";

describe("flags", () => {
  it("derives kebab flags, negatable booleans and choices", () => {
    const flags = flagsFor(sample);
    const byFlag = (f: string) => flags.find((s) => s.flags === f);
    expect(byFlag("--title <value>")?.required).toBe(true);
    expect(byFlag("--ai-enabled")).toBeDefined();
    expect(byFlag("--no-ai-enabled")).toBeDefined();
    expect(byFlag("--no-published")).toBeDefined();
    expect(byFlag("--published")).toBeUndefined();
    expect(byFlag("--allowed-locales <value>")).toMatchObject({ array: true, choices: ["en", "de"] });
    expect(byFlag("--mode <value>")?.choices).toEqual(["a", "b"]);
    expect(flags.some((s) => s.field === "id")).toBe(false);
  });

  it("parses numbers, positionals and leaves unpassed fields out", () => {
    const values = parseFlagValues(sample, { title: "x", count: "3" }, ["7"]);
    expect(values).toEqual({ id: 7, title: "x", count: 3 });
    expect("ai_enabled" in values).toBe(false);
  });

  it("rejects a non-numeric number", () => {
    expect(() => parseFlagValues(sample, { count: "abc" }, [])).toThrow(InputError);
  });

  it("reads @file values and keeps @@ as a literal @", () => {
    const readFile = (path: string) => (path === "body.md" ? "# From file" : "");
    expect(parseFlagValues(sample, { title: "@body.md" }, [], readFile).title).toBe("# From file");
    expect(parseFlagValues(sample, { title: "@@user" }, [], readFile).title).toBe("@user");
    expect(parseFlagValues(sample, { count: "5" }, [], () => "never").count).toBe(5);
  });

  it("reports an unreadable file with the flag name", () => {
    const readFile = () => {
      throw new Error("ENOENT");
    };
    expect(() => parseFlagValues(sample, { title: "@nope" }, [], readFile)).toThrow(/--title/);
  });

  it("parses json fields and reports bad JSON with the flag name", () => {
    expect(parseFlagValues(sample, { theme: '{"a":"b"}' }, []).theme).toEqual({ a: "b" });
    expect(parseFlagValues(sample, { theme: "@t.json" }, [], () => '{"c":"d"}').theme).toEqual({ c: "d" });
    try {
      parseFlagValues(sample, { theme: "{oops" }, []);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InputError);
      expect((error as InputError).fields).toEqual(["theme"]);
      expect((error as InputError).message).not.toContain("oops");
    }
  });

  it("keeps array values", () => {
    expect(parseFlagValues(sample, { allowedLocales: ["en", "de"] }, []).allowed_locales).toEqual(["en", "de"]);
  });
});
