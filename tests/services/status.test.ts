import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStatus } from "../../src/services/status.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ldesk-status-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const env = () => ({
  LIBREDESK_CONFIG_DIR: dir,
  LIBREDESK_URL: "https://desk.example/",
  LIBREDESK_API_KEY: "key-12345678",
  LIBREDESK_API_SECRET: "super-secret-value",
});

describe("getStatus", () => {
  it("reports an unreachable server without throwing and masks the key", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("connect ECONNREFUSED super-secret-value"));
    const report = await getStatus({ env: env(), fetchImpl });
    expect(report).toMatchObject({ reachable: false, profile: "env", source: "env", url: "https://desk.example" });
    expect(report.apiKey).toBe("••••5678");
    expect(JSON.stringify(report)).not.toContain("super-secret-value");
    expect(report.error).toMatch(/failed/);
  });

  it("reports the agent when the server answers", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: "success", data: { id: 1, email: "me@x.y", first_name: "", last_name: "" } }), {
        headers: { "content-type": "application/json" },
      }),
    );
    const report = await getStatus({ env: env(), fetchImpl });
    expect(report).toMatchObject({ reachable: true, agent: "me@x.y", targetVersion: "2.9.2" });
  });

  it("reports a wrong base URL (HTML answer) as not reachable, with the hint", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("<html>Welcome</html>", { status: 200, headers: { "content-type": "text/html" } }),
    );
    const report = await getStatus({ env: env(), fetchImpl });
    expect(report.reachable).toBe(false);
    expect(report.agent).toBeUndefined();
    expect(report.hint).toContain("base URL");
  });
});
