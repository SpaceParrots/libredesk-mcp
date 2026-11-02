import { describe, expect, it } from "vitest";
import { isRecord } from "../src/guards.js";
import {
  ApiError, AuthError, ConfirmationRequiredError, InputError, NetworkError, NotFoundError, PermissionError, toLibreDeskError,
} from "../src/errors.js";

describe("toLibreDeskError", () => {
  it("keeps LibreDeskError instances", () => {
    const e = new NotFoundError("x", { status: 404 });
    expect(toLibreDeskError(e)).toBe(e);
  });
  it("maps ECONNREFUSED to NetworkError with a hint", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const out = toLibreDeskError(err);
    expect(out).toBeInstanceOf(NetworkError);
    expect(out.hint).toMatch(/URL/);
  });
  it("wraps unknown values", () => {
    expect(toLibreDeskError("boom").code).toBe("UNKNOWN");
    expect(toLibreDeskError(new Error("e")).code).toBe("UNKNOWN");
  });
});

describe("error classes", () => {
  it("carry fixed codes and extra fields", () => {
    expect(new AuthError("a", { status: 401 }).code).toBe("AUTH");
    expect(new AuthError("a", { status: 401 })).toBeInstanceOf(ApiError);
    expect(new PermissionError("p", { status: 403, permission: "articles:read" }).permission).toBe("articles:read");
    expect(new ApiError("x", { status: 500, errorType: "GeneralError" }).code).toBe("API");
    expect(new InputError("i", { fields: ["a"] }).fields).toEqual(["a"]);
    expect(new ConfirmationRequiredError("c").code).toBe("CONFIRMATION_REQUIRED");
  });
});

describe("isRecord", () => {
  it("accepts plain objects only", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
  });
});
