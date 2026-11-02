import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EMPTY_CONFIG, assertValidProfileName, getConfigPath, linkProject, loadConfig, normalizeProjectPath, normalizeUrl,
  removeProfile, saveConfig, unlinkProject, upsertProfile, useProfile, type Profile,
} from "../src/config.js";
import { ConfigError, ProfileNotFoundError } from "../src/errors.js";

const p = (name: string): Profile => ({ name, url: `https://${name}.example`, apiKey: "k", apiSecret: "s" });

describe("normalizeUrl", () => {
  it("normalizes trailing slashes and keeps path prefixes", () => {
    expect(normalizeUrl(" https://example.com/helpdesk/ ")).toBe("https://example.com/helpdesk");
    expect(normalizeUrl("https://example.com///")).toBe("https://example.com");
  });
  it("rejects urls with userinfo", () => {
    expect(() => normalizeUrl("https://user:pass@example.com")).toThrow(ConfigError);
    expect(() => normalizeUrl("https://user@example.com/helpdesk")).toThrow(ConfigError);
  });
  it("does not echo the password of a rejected url", () => {
    let message = "";
    try {
      normalizeUrl("https://user:hunter2@example.com");
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).not.toBe("");
    expect(message).not.toContain("hunter2");
  });
  it("rejects non-http urls", () => {
    expect(() => normalizeUrl("ftp://x")).toThrow(ConfigError);
    expect(() => normalizeUrl("not a url")).toThrow(ConfigError);
  });
});

describe("assertValidProfileName", () => {
  it("accepts slugs and rejects path-unsafe names", () => {
    expect(() => assertValidProfileName("prod-1_a")).not.toThrow();
    for (const bad of ["", "Prod", "-x", "a/b", "..", "a b"]) {
      expect(() => assertValidProfileName(bad)).toThrow(ConfigError);
    }
  });
});

describe("normalizeProjectPath", () => {
  it("uses forward slashes and no trailing slash", () => {
    const out = normalizeProjectPath(join(tmpdir(), "a", "b") + "/");
    expect(out).not.toMatch(/\\/);
    expect(out).not.toMatch(/\/$/);
  });
  it.skipIf(process.platform !== "win32")("lower-cases the drive letter on Windows", () => {
    expect(normalizeProjectPath("D:\\Work\\Site\\")).toBe("d:/Work/Site");
  });
});

describe("config transforms", () => {
  it("first profile becomes active, second does not", () => {
    const one = upsertProfile(EMPTY_CONFIG, p("prod"));
    const two = upsertProfile(one, p("staging"));
    expect(one.activeProfile).toBe("prod");
    expect(two.activeProfile).toBe("prod");
    expect(Object.keys(two.profiles)).toEqual(["prod", "staging"]);
    expect(EMPTY_CONFIG.profiles).toEqual({});
  });
  it("upsert normalizes the url and stores no name field", () => {
    const cfg = upsertProfile(EMPTY_CONFIG, { ...p("prod"), url: "https://x.example/desk/" });
    expect(cfg.profiles.prod).toEqual({ url: "https://x.example/desk", apiKey: "k", apiSecret: "s" });
  });
  it("removing the active profile clears active and its project links", () => {
    let cfg = upsertProfile(upsertProfile(EMPTY_CONFIG, p("prod")), p("staging"));
    cfg = linkProject(linkProject(cfg, tmpdir(), "prod"), join(tmpdir(), "other"), "staging");
    const out = removeProfile(cfg, "prod");
    expect(out.activeProfile).toBeNull();
    expect(out.profiles.prod).toBeUndefined();
    expect(Object.values(out.projects)).toEqual(["staging"]);
  });
  it("useProfile switches active and rejects unknown names listing known ones", () => {
    const cfg = upsertProfile(upsertProfile(EMPTY_CONFIG, p("prod")), p("staging"));
    expect(useProfile(cfg, "staging").activeProfile).toBe("staging");
    expect(() => useProfile(cfg, "nope")).toThrow(ProfileNotFoundError);
    expect(() => useProfile(cfg, "nope")).toThrow(/prod, staging/);
  });
  it("rejects names inherited from Object.prototype", () => {
    const cfg = upsertProfile(EMPTY_CONFIG, p("prod"));
    expect(() => useProfile(cfg, "constructor")).toThrow(ProfileNotFoundError);
    expect(() => linkProject(cfg, tmpdir(), "toString")).toThrow(ProfileNotFoundError);
    expect(() => removeProfile(cfg, "valueOf")).toThrow(ProfileNotFoundError);
  });
  it("linkProject replaces a link for the same path and unlinkProject removes it", () => {
    const cfg = upsertProfile(upsertProfile(EMPTY_CONFIG, p("prod")), p("staging"));
    const linked = linkProject(linkProject(cfg, tmpdir(), "prod"), tmpdir() + "/", "staging");
    expect(Object.values(linked.projects)).toEqual(["staging"]);
    expect(unlinkProject(linked, tmpdir()).projects).toEqual({});
    expect(() => linkProject(cfg, tmpdir(), "nope")).toThrow(ProfileNotFoundError);
  });
});

describe("config file", () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ldesk-config-"));
    env = { LIBREDESK_CONFIG_DIR: dir };
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns the empty config when the file is missing", async () => {
    expect(await loadConfig(env)).toEqual(EMPTY_CONFIG);
  });
  it("save then load round-trips and writes mode 0600 on POSIX", async () => {
    const cfg = upsertProfile(EMPTY_CONFIG, p("prod"));
    await saveConfig(cfg, env);
    expect(await loadConfig(env)).toEqual(cfg);
    if (process.platform !== "win32") {
      expect((await stat(getConfigPath(env))).mode & 0o777).toBe(0o600);
    }
  });
  it("creates missing parent directories and leaves no temp file", async () => {
    const nested = { LIBREDESK_CONFIG_DIR: join(dir, "a", "b") };
    await saveConfig(EMPTY_CONFIG, nested);
    expect(await readFile(getConfigPath(nested), "utf8")).toContain("profiles");
    await expect(stat(getConfigPath(nested) + ".tmp")).rejects.toThrow();
  });
  it("invalid JSON throws ConfigError naming the file", async () => {
    await writeFile(getConfigPath(env), "{ nope", "utf8");
    const err = await loadConfig(env).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).hint).toContain(getConfigPath(env));
  });
  it("a JSON file of the wrong shape throws ConfigError", async () => {
    await writeFile(getConfigPath(env), JSON.stringify({ profiles: [] }), "utf8");
    await expect(loadConfig(env)).rejects.toThrow(ConfigError);
  });
});
