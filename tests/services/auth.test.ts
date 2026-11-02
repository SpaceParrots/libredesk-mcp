import { describe, expect, it, vi } from "vitest";
import { AuthError } from "../../src/errors.js";
import { verifyCredentials } from "../../src/services/auth.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("verifyCredentials", () => {
  it("returns the agent from /api/v1/agents/me and sends the token header", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      json({ status: "success", data: { id: 3, email: "a@b.c", first_name: "A", last_name: "B" } }),
    );
    const agent = await verifyCredentials({ url: "https://desk.example/", apiKey: "k", apiSecret: "s" }, fetchImpl);
    expect(agent.email).toBe("a@b.c");
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://desk.example/api/v1/agents/me");
    expect((init?.headers as Record<string, string>).Authorization).toBe("token k:s");
  });

  it("throws AuthError on 401", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ message: "bad" }, 401));
    await expect(verifyCredentials({ url: "https://x.example", apiKey: "k", apiSecret: "s" }, fetchImpl)).rejects.toThrow(AuthError);
  });
});
