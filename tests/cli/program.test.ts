import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgram } from "../../src/cli/program.js";
import type { CliDeps } from "../../src/cli/domain-commands.js";
import type { PromptAdapter } from "../../src/cli/prompt.js";
import { loadConfig } from "../../src/config.js";
import { ConfirmationRequiredError, InputError } from "../../src/errors.js";
import { neverPrompt } from "./helpers.js";

let dir: string;
let cwd: string;
let out: string[];
let errors: unknown[];
let printed: { data: unknown; json: boolean }[];
const savedEnv: Record<string, string | undefined> = {};
const ENV_NAMES = ["LIBREDESK_CONFIG_DIR", "LIBREDESK_URL", "LIBREDESK_API_KEY", "LIBREDESK_API_SECRET", "LIBREDESK_PROFILE"];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ldesk-cli-"));
  cwd = process.cwd();
  for (const name of ENV_NAMES) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
  process.env.LIBREDESK_CONFIG_DIR = join(dir, "config");
  out = [];
  errors = [];
  printed = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  process.chdir(cwd);
  for (const name of ENV_NAMES) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  await rm(dir, { recursive: true, force: true });
});

function deps(overrides: Partial<CliDeps> = {}): CliDeps {
  return {
    isTTY: false,
    prompt: neverPrompt,
    run: () => Promise.resolve({ ok: true }),
    print: (data, opts) => {
      printed.push({ data, json: opts.json });
    },
    onError: (err) => {
      errors.push(err);
      throw new Error("exit");
    },
    ...overrides,
  };
}

async function run(args: string[], d: CliDeps = deps(), extras = {}): Promise<void> {
  const program = createProgram(d, extras);
  program.exitOverride();
  await program.parseAsync(["node", "ldesk", ...args]).catch((error: unknown) => {
    if (!(error instanceof Error && error.message === "exit")) throw error;
  });
}

function stubMe(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ status: "success", data: { id: 1, email: "kevin@x.y", first_name: "K", last_name: "M" } }), {
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const loginArgs = ["login", "--url", "https://help.desk.example/", "--api-key", "key-12345678", "--api-secret", "top-secret-value"];

describe("login", () => {
  it("saves a profile named after the host and makes the first one active", async () => {
    stubMe();
    await run(loginArgs);
    const config = await loadConfig();
    expect(config.activeProfile).toBe("help-desk-example");
    expect(config.profiles["help-desk-example"]).toMatchObject({ url: "https://help.desk.example", apiKey: "key-12345678" });
    expect(out.join("")).toContain("Logged in to https://help.desk.example as kevin@x.y. Profile help-desk-example is active.");
    expect(out.join("")).not.toContain("top-secret-value");
  });

  it("says saved when another profile is already active", async () => {
    stubMe();
    await run(loginArgs);
    out.length = 0;
    await run([...loginArgs, "--name", "second"]);
    expect(out.join("")).toContain("Profile second is saved.");
  });

  it("in non-TTY without --api-secret fails naming the flag", async () => {
    await run(["login", "--url", "https://x.example", "--api-key", "k"]);
    expect(errors[0]).toBeInstanceOf(InputError);
    expect((errors[0] as Error).message).toContain("--api-secret");
    expect((errors[0] as Error).message).not.toContain("--url");
  });

  it("in non-TTY needs --yes to overwrite a profile", async () => {
    stubMe();
    await run(loginArgs);
    await run(loginArgs);
    expect(errors[0]).toBeInstanceOf(ConfirmationRequiredError);
    await run([...loginArgs, "--yes"]);
    expect(errors).toHaveLength(1);
  });

  it("with a TTY prompts for missing values, using password for the secret", async () => {
    stubMe();
    const asked: string[] = [];
    const prompt: PromptAdapter = {
      ...neverPrompt,
      text: (o) => {
        asked.push(`text:${o.message}`);
        return Promise.resolve(o.message.toLowerCase().includes("url") ? "https://tty.example" : "key-abcdefgh");
      },
      password: (o) => {
        asked.push(`password:${o.message}`);
        return Promise.resolve("tty-secret");
      },
    };
    await run(["login"], deps({ isTTY: true, prompt }));
    expect(asked.filter((a) => a.startsWith("password:"))).toHaveLength(1);
    expect((await loadConfig()).profiles["tty-example"]?.apiSecret).toBe("tty-secret");
  });
});

describe("profile", () => {
  async function twoProfiles(): Promise<void> {
    stubMe();
    await run(loginArgs);
    await run([...loginArgs, "--name", "second"]);
    out.length = 0;
  }

  it("list marks the active profile", async () => {
    await twoProfiles();
    await run(["profile", "list"]);
    const rows = printed[0]?.data as { name: string; active: string }[];
    expect(rows.map((r) => [r.name, r.active])).toEqual([
      ["help-desk-example", "*"],
      ["second", ""],
    ]);
  });

  it("use, remove, link and unlink change the config", async () => {
    await twoProfiles();
    await run(["profile", "use", "second"]);
    expect((await loadConfig()).activeProfile).toBe("second");
    const project = join(dir, "project");
    await mkdir(project);
    process.chdir(project);
    await run(["profile", "link", "help-desk-example"]);
    expect(Object.values((await loadConfig()).projects)).toEqual(["help-desk-example"]);
    await run(["profile", "unlink"]);
    expect((await loadConfig()).projects).toEqual({});
    await run(["profile", "remove", "second"]);
    expect(Object.keys((await loadConfig()).profiles)).toEqual(["help-desk-example"]);
  });

  it("link without a name in non-TTY fails naming the argument", async () => {
    await twoProfiles();
    await run(["profile", "link"]);
    expect((errors[0] as Error).message).toContain("<name>");
  });

  it("use of an unknown profile fails", async () => {
    await run(["profile", "use", "nope"]);
    expect((errors[0] as Error).message).toContain("nope");
  });
});

describe("status", () => {
  it("prints the report with the key masked", async () => {
    stubMe();
    await run(loginArgs);
    await run(["status", "--json"]);
    const report = printed[0]?.data as Record<string, unknown>;
    expect(report).toMatchObject({ profile: "help-desk-example", reachable: true, apiKey: "••••5678" });
    expect(printed[0]?.json).toBe(true);
  });
});

describe("request", () => {
  beforeEach(() => {
    process.env.LIBREDESK_URL = "https://desk.example";
    process.env.LIBREDESK_API_KEY = "k";
    process.env.LIBREDESK_API_SECRET = "s";
  });

  it("sends repeated --query values and a JSON body", async () => {
    const fetchMock = stubMe();
    await run(["request", "post", "/api/v1/things", "--query", "a=1", "--query", "b=x=y", "--body", '{"c":2}']);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://desk.example/api/v1/things?a=1&b=x%3Dy");
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"c":2}');
    expect(printed).toHaveLength(1);
  });

  it("reads the body from @file", async () => {
    const fetchMock = stubMe();
    const file = join(dir, "body.json");
    await writeFile(file, '{"from":"file"}');
    await run(["request", "PUT", "/api/v1/things/1", "--body", `@${file}`]);
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].body).toBe('{"from":"file"}');
  });

  it("rejects bad paths, bad JSON and bad queries", async () => {
    stubMe();
    await run(["request", "get", "/admin"]);
    await run(["request", "get", "/api/v1/x", "--body", "{no"]);
    await run(["request", "get", "/api/v1/x", "--query", "novalue"]);
    expect(errors).toHaveLength(3);
    expect(errors.every((e) => e instanceof InputError)).toBe(true);
  });

  it("non-TTY DELETE needs --yes; TTY DELETE asks", async () => {
    const fetchMock = stubMe();
    await run(["request", "delete", "/api/v1/things/1"]);
    expect(errors[0]).toBeInstanceOf(ConfirmationRequiredError);
    expect(fetchMock).not.toHaveBeenCalled();
    await run(["request", "delete", "/api/v1/things/1", "--yes"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const confirm = vi.fn().mockResolvedValue(true);
    await run(["request", "delete", "/api/v1/things/2"], deps({ isTTY: true, prompt: { ...neverPrompt, confirm } }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("catalog", () => {
  it("lists all operations, or one domain", async () => {
    await run(["catalog"]);
    const all = printed[0]?.data as { tool: string; action: string; method: string; path: string; impact: string }[];
    expect(Object.keys(all[0] ?? {})).toEqual(["tool", "action", "method", "path", "impact"]);
    await run(["catalog", "help-center"]);
    const one = printed[1]?.data as { tool: string }[];
    expect(one.length).toBeGreaterThan(0);
    expect(one.length).toBeLessThan(all.length);
    expect(new Set(one.map((r) => r.tool))).toEqual(new Set(["libredesk_help_center"]));
  });

  it("fails for an unknown domain", async () => {
    await run(["catalog", "nope"]);
    expect((errors[0] as Error).message).toContain("nope");
  });
});

describe("mcp install", () => {
  async function withProfile(): Promise<string> {
    stubMe();
    await run(loginArgs);
    const project = join(dir, "project");
    await mkdir(project, { recursive: true });
    process.chdir(project);
    out.length = 0;
    return project;
  }

  it("project scope merges into ./.mcp.json with the active profile pinned", async () => {
    const project = await withProfile();
    await writeFile(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { other: { command: "o" } } }));
    await run(["mcp", "install", "--npx", "--toolsets", "articles"]);
    const text = await readFile(join(project, ".mcp.json"), "utf8");
    expect(text.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(text) as { mcpServers: Record<string, { command: string; env: Record<string, string> }> };
    expect(parsed.mcpServers.other).toEqual({ command: "o" });
    expect(parsed.mcpServers.libredesk).toMatchObject({
      command: "npx",
      env: { LIBREDESK_PROFILE: "help-desk-example", LIBREDESK_TOOLSETS: "articles" },
    });
  });

  it("print scope writes a snippet with a top-level mcpServers object and no file", async () => {
    const project = await withProfile();
    await run(["mcp", "install", "--scope", "print"]);
    const snippet = JSON.parse(out.join("")) as { mcpServers: Record<string, unknown> };
    expect(Object.keys(snippet.mcpServers)).toEqual(["libredesk"]);
    await expect(readFile(join(project, ".mcp.json"), "utf8")).rejects.toThrow();
  });

  it("project scope with --mode env needs --yes in non-TTY, then writes the credentials", async () => {
    const project = await withProfile();
    await run(["mcp", "install", "--mode", "env"]);
    expect(errors[0]).toBeInstanceOf(ConfirmationRequiredError);
    await expect(readFile(join(project, ".mcp.json"), "utf8")).rejects.toThrow();
    await run(["mcp", "install", "--mode", "env", "--yes"]);
    const parsed = JSON.parse(await readFile(join(project, ".mcp.json"), "utf8")) as {
      mcpServers: { libredesk: { env: Record<string, string> } };
    };
    expect(parsed.mcpServers.libredesk.env.LIBREDESK_API_SECRET).toBe("top-secret-value");
    expect(out.join("")).not.toContain("top-secret-value");
  });

  it("in a TTY asks before writing a secret and cancels on No", async () => {
    const project = await withProfile();
    const confirm = vi.fn().mockResolvedValue(false);
    await run(["mcp", "install", "--mode", "env"], deps({ isTTY: true, prompt: { ...neverPrompt, confirm } }));
    expect(confirm).toHaveBeenCalledTimes(1);
    await expect(readFile(join(project, ".mcp.json"), "utf8")).rejects.toThrow();
  });
});

describe("serve and interactive", () => {
  it("serve calls startServer; without one it reports not available", async () => {
    const startServer = vi.fn().mockResolvedValue(undefined);
    await run(["serve"], deps(), { startServer });
    expect(startServer).toHaveBeenCalledTimes(1);
    await run(["serve"]);
    expect((errors[0] as Error).message).toMatch(/not available yet/);
  });

  it("i calls runInteractive", async () => {
    const runInteractive = vi.fn().mockResolvedValue(undefined);
    await run(["i"], deps(), { runInteractive });
    expect(runInteractive).toHaveBeenCalledTimes(1);
  });
});
