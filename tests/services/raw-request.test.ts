import { describe, expect, it, vi } from "vitest";
import { ConfirmationRequiredError, InputError } from "../../src/errors.js";
import { rawRequest } from "../../src/services/raw-request.js";

const profile = { name: "p", url: "https://desk.example", apiKey: "k", apiSecret: "s" };
const ok = () =>
  vi.fn<typeof fetch>().mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({ status: "success", data: { a: 1 } }), { headers: { "content-type": "application/json" } })),
  );

describe("rawRequest", () => {
  it("refuses DELETE without confirm", async () => {
    const fetchImpl = ok();
    await expect(rawRequest({ method: "DELETE", path: "/api/v1/x/1" }, { profile, fetchImpl })).rejects.toThrow(ConfirmationRequiredError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects paths outside /api/v1", async () => {
    for (const path of ["/admin", "/api/v2/x", "api/v1/x", "/api/v1/../admin", "/api/v1/", "/healthz"]) {
      await expect(rawRequest({ method: "GET", path }, { profile, fetchImpl: ok() })).rejects.toThrow(InputError);
    }
  });

  it("sends query and body and returns the data", async () => {
    const fetchImpl = ok();
    const out = await rawRequest({ method: "POST", path: "/api/v1/x", query: { a: "b" }, body: { c: 1 } }, { profile, fetchImpl });
    expect(out).toEqual({ a: 1 });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://desk.example/api/v1/x?a=b");
    expect(init?.body).toBe('{"c":1}');
  });

  it("allows /health and a confirmed DELETE", async () => {
    await expect(rawRequest({ method: "GET", path: "/health" }, { profile, fetchImpl: ok() })).resolves.toEqual({ a: 1 });
    await expect(rawRequest({ method: "DELETE", path: "/api/v1/x/1", confirm: true }, { profile, fetchImpl: ok() })).resolves.toEqual({ a: 1 });
  });
});
