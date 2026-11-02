import { describe, expect, it } from "vitest";
import type { Profile } from "../src/config.js";
import { ApiError, AuthError, NetworkError, NotFoundError, PermissionError } from "../src/errors.js";
import { authHeader, buildUrl, request } from "../src/http.js";

const profile: Profile = { name: "t", url: "https://ex.com", apiKey: "key", apiSecret: "secret" };

interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: unknown;
}

function fakeFetch(status: number, payload: unknown, contentType = "application/json") {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body,
    });
    const text = typeof payload === "string" ? payload : JSON.stringify(payload);
    return Promise.resolve(new Response(text, { status, statusText: "Status", headers: { "Content-Type": contentType } }));
  };
  return { fetchImpl, calls };
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected rejection");
}

describe("buildUrl", () => {
  it("joins base path prefixes", () => {
    expect(buildUrl("https://ex.com/helpdesk", "/api/v1/tags", { a: 1, b: undefined })).toBe(
      "https://ex.com/helpdesk/api/v1/tags?a=1",
    );
  });
  it("strips a trailing slash from the base url", () => {
    expect(buildUrl("https://ex.com/helpdesk/", "/api/v1/tags")).toBe("https://ex.com/helpdesk/api/v1/tags");
  });
  it("strips several trailing slashes from the base url", () => {
    expect(buildUrl("https://ex.com/helpdesk//", "/api/v1/tags")).toBe("https://ex.com/helpdesk/api/v1/tags");
  });
  it("adds a missing leading slash and encodes values", () => {
    expect(buildUrl("https://ex.com", "api/v1/x", { q: "a b", f: true })).toBe("https://ex.com/api/v1/x?q=a+b&f=true");
  });
});

describe("authHeader", () => {
  it("builds the token header", () => {
    expect(authHeader(profile)).toBe("token key:secret");
  });
});

describe("request redaction", () => {
  const secretProfile: Profile = { ...profile, apiSecret: "s3cr3t-value" };

  it("redacts the secret before cutting a long error body, so no part of it survives the cut", async () => {
    const body = `${"x".repeat(190)}token key:s3cr3t-value`;
    const { fetchImpl } = fakeFetch(502, body, "text/html");
    const error = (await caught(request(secretProfile, "GET", "/api/v1/x", { fetchImpl }))) as ApiError;
    expect(error.message).not.toContain("s3cr3t");
    expect(error.message).not.toContain("token key:s3c");
  });

  it("redacts the secret from a server message", async () => {
    const { fetchImpl } = fakeFetch(400, { status: "error", message: "bad header token key:s3cr3t-value" });
    const error = (await caught(request(secretProfile, "GET", "/api/v1/x", { fetchImpl }))) as ApiError;
    expect(error.message).toBe("bad header ••••");
  });

  it("redacts the secret from success bodies, text and json, keys included", async () => {
    const text = fakeFetch(200, "echo: s3cr3t-value", "text/plain");
    await expect(request(secretProfile, "GET", "/api/v1/x", { fetchImpl: text.fetchImpl })).resolves.toBe("echo: ••••");
    const json = fakeFetch(200, { status: "success", data: { headers: ["token key:s3cr3t-value"], "s3cr3t-value": 1, n: 2 } });
    await expect(request(secretProfile, "GET", "/api/v1/x", { fetchImpl: json.fetchImpl })).resolves.toEqual({
      headers: ["••••"],
      "••••": 1,
      n: 2,
    });
  });
});

describe("request", () => {
  it("sends token auth and JSON body, unwraps data", async () => {
    const { fetchImpl, calls } = fakeFetch(200, { status: "success", data: { id: 7 } });
    await expect(request(profile, "POST", "/api/v1/x", { body: { a: 1 }, fetchImpl })).resolves.toEqual({ id: 7 });
    expect(calls[0].headers.get("Authorization")).toBe("token key:secret");
    expect(calls[0].headers.get("Accept")).toBe("application/json");
    expect(calls[0].headers.get("Content-Type")).toBe("application/json");
    expect(calls[0].body).toBe('{"a":1}');
  });

  it("requests a prefixed, slash-terminated profile url without doubling slashes", async () => {
    const { fetchImpl, calls } = fakeFetch(200, { status: "success", data: null });
    await request({ ...profile, url: "https://ex.com/helpdesk/" }, "GET", "/api/v1/tags", { fetchImpl });
    expect(calls[0].url).toBe("https://ex.com/helpdesk/api/v1/tags");
  });

  it("sends no Content-Type without a body", async () => {
    const { fetchImpl, calls } = fakeFetch(200, { status: "success", data: [] });
    await request(profile, "GET", "/api/v1/x", { fetchImpl });
    expect(calls[0].headers.has("Content-Type")).toBe(false);
  });

  it("returns an unwrapped JSON body as-is", async () => {
    const { fetchImpl } = fakeFetch(200, { items: [1] });
    await expect(request(profile, "GET", "/x", { fetchImpl })).resolves.toEqual({ items: [1] });
  });

  it("maps 401 to AuthError with a login hint", async () => {
    const { fetchImpl } = fakeFetch(401, { status: "error", message: "Invalid credentials" });
    const err = await caught(request(profile, "GET", "/x", { fetchImpl }));
    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).hint).toMatch(/ldesk login/);
  });

  it("maps 403 to PermissionError carrying the server message", async () => {
    const { fetchImpl } = fakeFetch(403, { status: "error", message: "Permission denied", error_type: "PermissionException" });
    const err = await caught(request(profile, "GET", "/x", { fetchImpl }));
    expect(err).toBeInstanceOf(PermissionError);
    expect((err as PermissionError).message).toBe("Permission denied");
    expect((err as PermissionError).hint).toMatch(/permission/);
  });

  it("maps 404 to NotFoundError", async () => {
    const { fetchImpl } = fakeFetch(404, { status: "error", message: "Tag not found", error_type: "NotFoundException" });
    await expect(request(profile, "GET", "/x", { fetchImpl })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("maps 400 InputException to ApiError with errorType and message", async () => {
    const { fetchImpl } = fakeFetch(400, { status: "error", message: "bad name", error_type: "InputException", data: { f: 1 } });
    const err = await caught(request(profile, "GET", "/x", { fetchImpl }));
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, errorType: "InputException", message: "bad name", data: { f: 1 } });
  });

  it("handles a non-JSON 502 body", async () => {
    const { fetchImpl } = fakeFetch(502, "<html>Bad Gateway</html>", "text/html");
    const err = await caught(request(profile, "GET", "/api/v1/x", { fetchImpl }));
    expect((err as ApiError).message).toMatch(/502/);
    expect((err as ApiError).message).toMatch(/Bad Gateway/);
  });

  it("truncates a long non-JSON body to 200 characters", async () => {
    const { fetchImpl } = fakeFetch(413, "x".repeat(500), "text/plain");
    const err = await caught(request(profile, "GET", "/x", { fetchImpl }));
    expect((err as Error).message.match(/x+/)?.[0].length).toBe(200);
  });

  it("never puts the secret into an error message or hint", async () => {
    const { fetchImpl } = fakeFetch(500, { status: "error", message: "bad token key:secret and secret" });
    const err = (await caught(request(profile, "GET", "/x", { fetchImpl }))) as ApiError;
    expect(err.message).toBe("bad •••• and ••••");
    expect(err.hint ?? "").not.toContain("secret");
  });

  it("redacts the secret from a NetworkError message and cause", async () => {
    const fetchImpl: typeof fetch = () => Promise.reject(new TypeError("refused for token key:secret / secret"));
    const err = (await caught(request(profile, "GET", "/x", { fetchImpl }))) as NetworkError;
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.message).not.toContain("secret");
    expect(err.message).not.toContain("key:");
    expect((err.cause as Error).message).not.toContain("secret");
    expect((err.cause as Error).message).toBe("refused for •••• / ••••");
  });

  it("times out with NetworkError naming the URL", async () => {
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    const err = await caught(request(profile, "GET", "/api/v1/slow", { fetchImpl, timeoutMs: 10 }));
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as Error).message).toContain("GET https://ex.com/api/v1/slow");
  });

  it("wraps a fetch rejection in NetworkError", async () => {
    const fetchImpl: typeof fetch = () => Promise.reject(new TypeError("fetch failed"));
    const err = await caught(request(profile, "GET", "/x", { fetchImpl }));
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as Error).message).toContain("fetch failed");
  });

  it("returns the text of a non-JSON 200 response (transcript)", async () => {
    const { fetchImpl } = fakeFetch(200, "hello transcript", "text/plain");
    await expect(request(profile, "GET", "/x", { fetchImpl })).resolves.toBe("hello transcript");
  });

  it("returns the text of an HTML 200 response (preview)", async () => {
    const { fetchImpl } = fakeFetch(200, "<html><body>Preview</body></html>", "text/html");
    await expect(request(profile, "GET", "/x", { fetchImpl })).resolves.toBe("<html><body>Preview</body></html>");
  });

  it("returns an empty string for an empty 2xx body", async () => {
    const { fetchImpl } = fakeFetch(200, "", "text/plain");
    await expect(request(profile, "GET", "/x", { fetchImpl })).resolves.toBe("");
  });
});
