import { describe, expect, it } from "vitest";
import type { Profile } from "../../src/config.js";
import { DOMAINS } from "../../src/domains/index.js";
import { lookupDomain } from "../../src/domains/lookup.js";
import { runOperation } from "../../src/ops/run.js";

const profile: Profile = { name: "t", url: "https://ex.com", apiKey: "key", apiSecret: "secret" };

function fakeFetch(data: unknown) {
  const calls: { method: string; path: string; search: string }[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const url = new URL(String(input));
    calls.push({ method: init?.method ?? "GET", path: url.pathname, search: url.search });
    return Promise.resolve(
      new Response(JSON.stringify({ status: "success", data }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
  };
  return { fetchImpl, calls };
}

function op(name: string) {
  const found = lookupDomain.operations.find((o) => o.name === name);
  if (!found) throw new Error(`no operation ${name}`);
  return found;
}

const cases: [string, string, boolean][] = [
  ["me", "/api/v1/agents/me", false],
  ["agents", "/api/v1/agents/compact", true],
  ["teams", "/api/v1/teams/compact", true],
  ["tags", "/api/v1/tags", false],
  ["inboxes", "/api/v1/inboxes", false],
  ["statuses", "/api/v1/statuses", false],
  ["priorities", "/api/v1/priorities", false],
  ["custom_attributes", "/api/v1/custom-attributes", false],
];

describe("lookup domain", () => {
  it("is registered with its tool name and toolset", () => {
    expect(DOMAINS).toContain(lookupDomain);
    expect(lookupDomain.name).toBe("lookup");
    expect(lookupDomain.tool).toBe("libredesk_lookup");
    expect(lookupDomain.toolset).toBe("core");
  });

  it("has exactly the planned operations, all read-only", () => {
    expect(lookupDomain.operations.map((o) => o.name)).toEqual(cases.map(([name]) => name));
    for (const o of lookupDomain.operations) expect(o.impact, o.name).toBe("read");
  });

  it.each(cases)("%s sends GET %s (undocumented: %s)", async (name, path, undocumented) => {
    const { fetchImpl, calls } = fakeFetch(name === "me" ? {} : []);
    await runOperation(op(name), {}, { profile, fetchImpl });
    expect(calls).toEqual([{ method: "GET", path, search: "" }]);
    expect(op(name).undocumented === true).toBe(undocumented);
  });

  it("custom_attributes sends applies_to as a query parameter", async () => {
    const { fetchImpl, calls } = fakeFetch([]);
    await runOperation(op("custom_attributes"), { applies_to: "contact" }, { profile, fetchImpl });
    expect(calls[0]?.search).toBe("?applies_to=contact");
  });

  it("me keeps identity and roles and drops api key fields", async () => {
    const { fetchImpl } = fakeFetch({
      id: 1,
      first_name: "Ada",
      last_name: "L",
      email: "a@ex.com",
      type: "agent",
      enabled: true,
      availability_status: "online",
      roles: ["Admin"],
      permissions: ["tags:manage"],
      teams: [{ id: 2, name: "Support", emoji: "x" }],
      api_key: "SECRETKEY",
      api_key_last_used_at: "2026-01-01T00:00:00Z",
      phone_number: "123",
    });
    const result = await runOperation(op("me"), {}, { profile, fetchImpl });
    expect(result).toEqual({
      id: 1,
      first_name: "Ada",
      last_name: "L",
      email: "a@ex.com",
      type: "agent",
      enabled: true,
      availability_status: "online",
      roles: ["Admin"],
      permissions: ["tags:manage"],
      teams: [{ id: 2, name: "Support" }],
    });
    expect(JSON.stringify(result)).not.toContain("SECRETKEY");
  });

  it("agents and teams keep the fields needed to pick", async () => {
    const agent = { id: 1, first_name: "Ada", last_name: "L", email: "a@ex.com", type: "agent", enabled: true, avatar_url: "u", created_at: "t" };
    const a = await runOperation(op("agents"), {}, { profile, fetchImpl: fakeFetch([agent]).fetchImpl });
    expect(a).toEqual([{ id: 1, first_name: "Ada", last_name: "L", email: "a@ex.com", type: "agent", enabled: true }]);
    const team = { id: 2, name: "Support", emoji: "x", created_at: "t" };
    const t = await runOperation(op("teams"), {}, { profile, fetchImpl: fakeFetch([team]).fetchImpl });
    expect(t).toEqual([{ id: 2, name: "Support", emoji: "x" }]);
  });

  it("inboxes drop config and secret", async () => {
    const inbox = { id: 1, name: "Mail", channel: "email", enabled: true, secret: "S3CRET", config: { password: "pw" }, uuid: "u" };
    const result = await runOperation(op("inboxes"), {}, { profile, fetchImpl: fakeFetch([inbox]).fetchImpl });
    expect(result).toEqual([{ id: 1, name: "Mail", channel: "email", enabled: true }]);
  });

  it("tags, statuses, priorities and custom attributes are trimmed", async () => {
    const one = (name: string, row: Record<string, unknown>) =>
      runOperation(op(name), {}, { profile, fetchImpl: fakeFetch([{ ...row, created_at: "t", updated_at: "t" }]).fetchImpl });
    expect(await one("tags", { id: 1, name: "bug" })).toEqual([{ id: 1, name: "bug" }]);
    expect(await one("statuses", { id: 1, name: "Open", category: "open" })).toEqual([{ id: 1, name: "Open", category: "open" }]);
    expect(await one("priorities", { id: 1, name: "High" })).toEqual([{ id: 1, name: "High" }]);
    expect(
      await one("custom_attributes", { id: 1, key: "plan", name: "Plan", applies_to: "contact", data_type: "list", values: ["a"], regex: "x" }),
    ).toEqual([{ id: 1, key: "plan", name: "Plan", applies_to: "contact", data_type: "list", values: ["a"] }]);
  });

  it("a null list (Go nil slice) gives an empty list", async () => {
    expect(await runOperation(op("tags"), {}, { profile, fetchImpl: fakeFetch(null).fetchImpl })).toEqual([]);
  });

  it("a non-null, non-array response throws with the base URL hint", async () => {
    for (const data of ["<html></html>", { a: 1 }, 7]) {
      await expect(runOperation(op("tags"), {}, { profile, fetchImpl: fakeFetch(data).fetchImpl })).rejects.toMatchObject({
        hint: expect.stringContaining("base URL"),
      });
    }
  });

  it("non-object items in a list are dropped", async () => {
    const result = await runOperation(op("tags"), {}, { profile, fetchImpl: fakeFetch([{ id: 1, name: "bug" }, "junk", null, 7]).fetchImpl });
    expect(result).toEqual([{ id: 1, name: "bug" }]);
  });

  it("me throws when the response is not an agent object", async () => {
    await expect(runOperation(op("me"), {}, { profile, fetchImpl: fakeFetch([]).fetchImpl })).rejects.toThrow();
  });
});
