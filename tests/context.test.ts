import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMPTY_CONFIG, linkProject, saveConfig, upsertProfile, type Profile } from "../src/config.js";
import { getCurrentProfile, resolveProfile, withProfile } from "../src/context.js";
import { NoProfileError, ProfileNotFoundError } from "../src/errors.js";

const p = (name: string): Profile => ({ name, url: `https://${name}.example`, apiKey: "k", apiSecret: "s" });
const stored = upsertProfile(upsertProfile(EMPTY_CONFIG, p("prod")), p("staging"));
const envAll = { LIBREDESK_URL: "https://env.example/", LIBREDESK_API_KEY: "k", LIBREDESK_API_SECRET: "s" };
const win = process.platform === "win32";
const root = win ? "D:/Work/site" : "/work/site";
const deep = win ? "d:\\Work\\site\\packages\\web" : "/work/site/packages/web";

describe("resolveProfile", () => {
  it("explicit override wins over everything", async () => {
    const r = await resolveProfile({ override: "staging", env: { ...envAll, LIBREDESK_PROFILE: "prod" }, config: stored });
    expect(r).toMatchObject({ source: "param", profile: { name: "staging", url: "https://staging.example" } });
  });
  it("complete env vars beat LIBREDESK_PROFILE and normalize the url", async () => {
    const r = await resolveProfile({ env: { ...envAll, LIBREDESK_PROFILE: "prod" }, config: stored });
    expect(r).toMatchObject({ source: "env", profile: { name: "env", url: "https://env.example", apiKey: "k", apiSecret: "s" } });
  });
  it("partial env vars fail naming the missing ones", async () => {
    const run = resolveProfile({ env: { LIBREDESK_URL: "https://x", LIBREDESK_API_KEY: "k" }, config: stored });
    await expect(run).rejects.toThrow(/LIBREDESK_API_SECRET/);
  });
  it("LIBREDESK_PROFILE beats project link", async () => {
    const cfg = linkProject(stored, root, "staging");
    const r = await resolveProfile({ env: { LIBREDESK_PROFILE: "prod" }, cwd: deep, config: cfg });
    expect(r).toMatchObject({ source: "LIBREDESK_PROFILE", profile: { name: "prod" } });
  });
  it("unknown profile names throw ProfileNotFoundError listing known names", async () => {
    const run = resolveProfile({ env: { LIBREDESK_PROFILE: "nope" }, config: stored });
    await expect(run).rejects.toThrow(ProfileNotFoundError);
    await expect(run).rejects.toThrow(/prod, staging/);
    await expect(resolveProfile({ override: "nope", env: {}, config: stored })).rejects.toThrow(ProfileNotFoundError);
  });
  it("project link matches a subdirectory of the linked dir", async () => {
    const cfg = linkProject(stored, root, "staging");
    const r = await resolveProfile({ env: {}, cwd: deep, config: cfg });
    expect(r).toMatchObject({ source: "project", profile: { name: "staging" } });
  });
  it("picks the longest matching project link and ignores sibling prefixes", async () => {
    const cfg = linkProject(linkProject(stored, root, "staging"), `${root}/packages`, "prod");
    expect(await resolveProfile({ env: {}, cwd: deep, config: cfg })).toMatchObject({ profile: { name: "prod" } });
    const sibling = win ? "d:\\Work\\site-other" : "/work/site-other";
    const only = linkProject(stored, root, "staging");
    expect(await resolveProfile({ env: {}, cwd: sibling, config: only })).toMatchObject({ source: "active" });
  });
  it("falls back to the active profile", async () => {
    const r = await resolveProfile({ env: {}, config: stored });
    expect(r).toMatchObject({ source: "active", profile: { name: "prod" } });
  });
  it("no profile at all throws NoProfileError with a hint to run ldesk login", async () => {
    const err = (await resolveProfile({ env: {}, config: EMPTY_CONFIG }).catch((e: unknown) => e)) as NoProfileError;
    expect(err).toBeInstanceOf(NoProfileError);
    expect(err.hint).toMatch(/ldesk login/);
    expect(err.hint).toMatch(/LIBREDESK_API_SECRET/);
  });
});

describe("withProfile", () => {
  let dir: string;
  let saved: Record<string, string | undefined>;
  const keys = ["LIBREDESK_CONFIG_DIR", "LIBREDESK_URL", "LIBREDESK_API_KEY", "LIBREDESK_API_SECRET", "LIBREDESK_PROFILE"];
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ldesk-context-"));
    saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) delete process.env[k];
    process.env.LIBREDESK_CONFIG_DIR = dir;
    await saveConfig(stored);
  });
  afterEach(async () => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await rm(dir, { recursive: true, force: true });
  });

  it("overrides getCurrentProfile inside the callback only", async () => {
    const inside = await withProfile("staging", async () => (await getCurrentProfile()).profile.name);
    expect(inside).toBe("staging");
    expect((await getCurrentProfile()).profile.name).toBe("prod");
  });
  it("undefined falls through to normal resolution", async () => {
    expect(await withProfile(undefined, async () => (await getCurrentProfile()).source)).toBe("active");
  });
});
