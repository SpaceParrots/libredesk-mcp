import { describe, expect, it } from "vitest";
import { maskSecrets, maskValue, redactDeep, redactText } from "../src/mask.js";

describe("maskSecrets", () => {
  it("masks secret keys at any depth and leaves others", () => {
    const out = maskSecrets({ name: "a", api_secret: "abcdefgh1234", nested: { password: "pw", list: [{ token: "t0k3nvalue" }] } });
    expect(out).toEqual({ name: "a", api_secret: "••••1234", nested: { password: "••••", list: [{ token: "••••alue" }] } });
  });
  it("matches keys case-insensitively", () => {
    expect(maskSecrets({ Authorization: "token k:s3cr3tvalue" })).toEqual({ Authorization: "••••alue" });
  });
  it("masks every value inside a headers object", () => {
    expect(maskSecrets({ headers: { "X-Api-Key": "supersecret", Accept: "json" } }))
      .toEqual({ headers: { "X-Api-Key": "••••cret", Accept: "••••" } });
  });
  it("does not mutate its input", () => {
    const input = { api_key: "abcdefgh", nested: { token: "abcdefghij" } };
    const out = maskSecrets(input);
    expect(input.api_key).toBe("abcdefgh");
    expect(input.nested.token).toBe("abcdefghij");
    expect(out).not.toBe(input);
  });
  it("passes primitives through", () => {
    expect(maskSecrets(5)).toBe(5);
    expect(maskSecrets(null)).toBeNull();
  });
});

describe("maskValue", () => {
  it("keeps the last 4 characters only for values of 8 or more", () => {
    expect(maskValue("12345678")).toBe("••••5678");
    expect(maskValue("1234567")).toBe("••••");
  });
});

describe("redactText", () => {
  it("redacts known secrets from free text", () => {
    expect(redactText("token k:s3cr3tvalue failed", ["s3cr3tvalue"])).toBe("token k:•••• failed");
  });
  it("ignores empty secrets", () => {
    expect(redactText("abc", [""])).toBe("abc");
  });
});

describe("redactDeep", () => {
  it("redacts every string in a nested value, keys included, without changing the input", () => {
    const input = { a: ["x s3cr3t"], s3cr3t: { n: 1, ok: true, none: null } };
    expect(redactDeep(input, ["s3cr3t"])).toEqual({ a: ["x ••••"], "••••": { n: 1, ok: true, none: null } });
    expect(input.a[0]).toBe("x s3cr3t");
  });
});
