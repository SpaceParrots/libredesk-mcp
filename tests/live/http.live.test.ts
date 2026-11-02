/**
 * @module tests/live/http.live.test
 * Live checks of the HTTP client against a local LibreDesk.
 */

import { expect, it } from "vitest";
import { AuthError } from "../../src/errors.js";
import { request } from "../../src/http.js";
import { describeLive, liveProfile } from "./helpers.js";

describeLive("http against local LibreDesk", () => {
  it("GET /api/v1/agents/me returns the bootstrap agent", async () => {
    const me = await request<{ email: string }>(liveProfile()!, "GET", "/api/v1/agents/me");
    expect(me.email).toBe("ldesk-dev@example.com");
  });

  it("a wrong secret gives AuthError", async () => {
    const profile = { ...liveProfile()!, apiSecret: "wrong-secret" };
    await expect(request(profile, "GET", "/api/v1/agents/me")).rejects.toBeInstanceOf(AuthError);
  });
});
