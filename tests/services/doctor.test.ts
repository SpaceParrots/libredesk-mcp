import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDoctorReport } from "../../src/commands/doctor.js";
import { PACKAGE_NAME } from "../../src/constants.js";
import { NoProfileError } from "../../src/errors.js";
import { discoverClientConfigs, isLibreDeskEntry } from "../../src/services/client-config.js";
import { commandLine, meetsVersion, runDoctor, type DoctorCheck, type DoctorDeps } from "../../src/services/doctor.js";
import { expandVars, planSpawn, probeLaunch, resolveCommand } from "../../src/services/mcp-probe.js";
import type { StatusReport } from "../../src/services/status.js";
import { fakeSpawn, type Behaviour } from "./fake-child.js";

const pkg = createRequire(import.meta.url)("../../package.json") as { version: string };

const EXEC = "/usr/bin/node";
const SCRIPT = "/opt/ldesk/dist/index.js";
const SECRET = "super-secret-value";

let dir: string;
let home: string;
let cwd: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ldesk-doctor-"));
  home = join(dir, "home");
  cwd = join(dir, "project");
  await mkdir(home);
  await mkdir(cwd);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const reachable: StatusReport = {
  profile: "prod",
  source: "active",
  url: "https://desk.example",
  apiKey: "••••5678",
  reachable: true,
  agent: "me@x.y",
  targetVersion: "2.9.2",
  configPath: "/x/config.json",
};

const ok: Behaviour = { kind: "answer", name: PACKAGE_NAME, version: pkg.version };

async function writeClaude(root: unknown): Promise<void> {
  await writeFile(join(home, ".claude.json"), JSON.stringify(root));
}

async function writeProject(root: unknown): Promise<void> {
  await writeFile(join(cwd, ".mcp.json"), JSON.stringify(root));
}

function deps(spawnFor: (command: string, args: readonly string[]) => Behaviour, extra: Partial<DoctorDeps> = {}) {
  const fake = fakeSpawn(spawnFor);
  const stop = vi.fn();
  const d: DoctorDeps = {
    env: { PATH: "/usr/bin" },
    cwd,
    homeDir: home,
    platform: "linux",
    nodeVersion: "v22.12.0",
    execPath: EXEC,
    scriptPath: SCRIPT,
    status: () => Promise.resolve(reachable),
    exists: () => false,
    spawn: fake.spawn,
    stop,
    timeoutMs: 1000,
    ...extra,
  };
  return { deps: d, calls: fake.calls, stop };
}

function check(checks: readonly DoctorCheck[], name: string): DoctorCheck {
  const found = checks.find((c) => c.name === name);
  if (found === undefined) throw new Error(`no check ${name} in ${checks.map((c) => c.name).join(", ")}`);
  return found;
}

describe("discoverClientConfigs", () => {
  it("finds user, local and project entries and keeps only the one Claude Code uses per name", async () => {
    await writeClaude({
      mcpServers: {
        libredesk: { command: "ldesk", args: ["serve"], env: { LIBREDESK_PROFILE: "prod" } },
        other: { command: "node", args: ["other.js"] },
      },
      projects: {
        [cwd.replaceAll("\\", "/")]: { mcpServers: { desk: { command: "npx", args: ["-y", "@spaceparrots/libredesk-mcp", "serve"] } } },
        "/somewhere/else": { mcpServers: { elsewhere: { command: "ldesk", args: ["serve"] } } },
      },
    });
    await writeProject({
      mcpServers: {
        libredesk: { command: "node", args: [SCRIPT, "serve"] },
        web: { type: "http", url: "https://desk.example/mcp" },
        "libredesk-remote": { type: "http", url: "https://x.example", headers: {}, command: "ldesk" },
      },
    });
    const found = await discoverClientConfigs({ homeDir: home, cwd, env: {}, platform: process.platform, scriptPath: SCRIPT });
    expect(found.entries.map((e) => `${e.name}:${e.scope}`)).toEqual(["desk:local", "libredesk:project"]);
    expect(found.entries[1]?.args).toEqual([SCRIPT, "serve"]);
    expect(found.files).toHaveLength(2);
    expect(found.files[0]).toMatchObject({ state: "found", matched: ["libredesk (user)", "desk (local)"] });
    expect(found.files[1]).toMatchObject({ state: "found", notStdio: ["libredesk-remote"] });
  });

  it("reports missing and invalid files instead of throwing", async () => {
    await writeFile(join(cwd, ".mcp.json"), "{ not json");
    const found = await discoverClientConfigs({ homeDir: home, cwd, env: {}, platform: process.platform, scriptPath: SCRIPT });
    expect(found.entries).toEqual([]);
    expect(found.files.map((f) => f.state)).toEqual(["missing", "invalid"]);
    expect(found.files[1]?.problem).toBe("is not valid JSON");
  });

  it("reads .claude.json from CLAUDE_CONFIG_DIR when it is set", async () => {
    const other = join(dir, "claude-dir");
    await mkdir(other);
    await writeFile(join(other, ".claude.json"), JSON.stringify({ mcpServers: { libredesk: { command: "ldesk", args: ["serve"] } } }));
    const found = await discoverClientConfigs({ homeDir: home, cwd, env: { CLAUDE_CONFIG_DIR: other }, platform: process.platform, scriptPath: SCRIPT });
    expect(found.entries.map((e) => e.file)).toEqual([join(other, ".claude.json")]);
  });

  it("matches by name, by the ldesk binary, by the package name and by the running script", () => {
    expect(isLibreDeskEntry("LibreDesk", "x", [], SCRIPT, "linux")).toBe(true);
    expect(isLibreDeskEntry("a", "C:\\nvm\\nodejs\\ldesk.exe", ["serve"], SCRIPT, "win32")).toBe(true);
    expect(isLibreDeskEntry("a", "cmd", ["/c", "ldesk", "serve"], SCRIPT, "win32")).toBe(true);
    expect(isLibreDeskEntry("a", "node", ["C:/x/node_modules/@spaceparrots/libredesk-mcp/dist/index.js"], "", "win32")).toBe(true);
    expect(isLibreDeskEntry("a", "node", ["D:\\Tools\\Desk\\dist\\index.js"], "d:/tools/desk/dist/index.js", "win32")).toBe(true);
    expect(isLibreDeskEntry("a", "node", ["/other/dist/index.js"], SCRIPT, "linux")).toBe(false);
    expect(isLibreDeskEntry("a", "libredesk", [], SCRIPT, "linux")).toBe(false);
  });
});

describe("runDoctor", () => {
  it("reports ok for an entry that answers initialize", async () => {
    await writeClaude({ mcpServers: { libredesk: { command: "ldesk", args: ["serve"] } } });
    const { deps: d, calls, stop } = deps(() => ok);
    const report = await runDoctor(d);
    expect(report.ok).toBe(true);
    const launch = check(report.checks, "launch libredesk");
    expect(launch).toMatchObject({ state: "ok", detail: `answered as ${PACKAGE_NAME} ${pkg.version}` });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ command: "ldesk", args: ["serve"], options: { shell: false, cwd } });
    expect(JSON.parse(calls[0]?.child.received ?? "")).toMatchObject({ method: "initialize", id: 1 });
    expect(stop).toHaveBeenCalledWith(calls[0]?.child);
    expect(report.checks.map((c) => c.name)).toEqual(["node", "script", "profile", "config", "config", "launch libredesk"]);
  });

  it("never prints env values of an entry, only their names, even when the server echoes them", async () => {
    await writeClaude({
      mcpServers: { libredesk: { command: "ldesk", args: ["serve"], env: { LIBREDESK_API_SECRET: SECRET, LIBREDESK_PROFILE: "prod-profile" } } },
    });
    const { deps: d, calls } = deps((command) => (command === EXEC ? ok : { kind: "crash", code: 1, stderr: `bad secret ${SECRET}\n` }));
    const report = await runDoctor(d);
    const text = `${JSON.stringify(report)}\n${formatDoctorReport(report)}`;
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("prod-profile");
    expect(text).toContain("env keys: LIBREDESK_API_SECRET, LIBREDESK_PROFILE");
    expect(text).toContain("-e LIBREDESK_API_SECRET=<LIBREDESK_API_SECRET>");
    // The launch itself gets the real values.
    expect(calls[0]?.options.env).toMatchObject({ LIBREDESK_API_SECRET: SECRET, PATH: "/usr/bin" });
  });

  it("shows the exit code, the server's last lines and the claude mcp add fix when the direct launch works", async () => {
    await writeClaude({ mcpServers: { libredesk: { command: "ldesk", args: ["serve"] } } });
    const { deps: d, calls } = deps((command) =>
      command === EXEC ? ok : { kind: "crash", code: 1, stdout: "ldesk is not installed for this Node.js version\n", stderr: "warning: shim\n" },
    );
    const report = await runDoctor(d);
    expect(report.ok).toBe(false);
    const launch = check(report.checks, "launch libredesk");
    expect(launch.state).toBe("fail");
    expect(launch.detail).toBe("exited with code 1 before answering");
    expect(launch.output).toEqual(["warning: shim", "ldesk is not installed for this Node.js version"]);
    expect(launch.fix).toEqual([
      "claude mcp remove --scope user libredesk",
      `claude mcp add --scope user libredesk -- "${EXEC}" "${SCRIPT}" serve`,
    ]);
    expect(check(report.checks, "launch direct")).toMatchObject({ state: "ok" });
    expect(calls.map((c) => c.command)).toEqual(["ldesk", EXEC]);
    expect(calls[1]?.args).toEqual([SCRIPT, "serve"]);
    const text = formatDoctorReport(report);
    expect(text).toContain("| ldesk is not installed for this Node.js version");
    expect(text).toContain(`fix: claude mcp remove --scope user libredesk`);
    expect(text).toContain("1 check failed.");
  });

  it("starts an entry from ./.mcp.json only when the user trusts it", async () => {
    await writeProject({ mcpServers: { libredesk: { command: "sh", args: ["-c", "evil"] } } });
    const asked: string[] = [];
    const refuse = deps(() => ok, { trustProject: (_name, command) => (asked.push(command), Promise.resolve(false)) });
    const report = await runDoctor(refuse.deps);
    expect(asked).toEqual(["sh -c evil"]);
    expect(refuse.calls.map((c) => c.command)).not.toContain("sh");
    expect(check(report.checks, "launch libredesk")).toMatchObject({ state: "warn", detail: expect.stringContaining("not started") as unknown });

    const silent = deps(() => ok);
    await runDoctor(silent.deps);
    expect(silent.calls.map((c) => c.command)).not.toContain("sh");

    const trust = deps(() => ok, { trustProject: () => Promise.resolve(true) });
    expect(check((await runDoctor(trust.deps)).checks, "launch libredesk").state).toBe("ok");
  });

  it("overrides a failing .mcp.json entry with a local one instead of removing it", async () => {
    await writeProject({ mcpServers: { libredesk: { command: "ldesk", args: ["serve"] } } });
    const { deps: d } = deps((command) => (command === EXEC ? ok : { kind: "spawn-error", code: "ENOENT" }), { trustProject: () => Promise.resolve(true) });
    const launch = check((await runDoctor(d)).checks, "launch libredesk");
    expect(launch.detail).toBe("could not be started: ENOENT");
    expect(launch.fix).toEqual(["Override the .mcp.json entry for this folder:", `claude mcp add --scope local libredesk -- "${EXEC}" "${SCRIPT}" serve`]);
  });

  it("gives no claude mcp add line when the direct launch fails too", async () => {
    await writeClaude({ mcpServers: { libredesk: { command: "ldesk", args: ["serve"] } } });
    const { deps: d } = deps(() => ({ kind: "crash", code: 1, stderr: "Error: Cannot find module\n" }));
    const report = await runDoctor(d);
    expect(check(report.checks, "launch libredesk").fix).toEqual(["The server does not start with node directly either; see launch direct."]);
    expect(check(report.checks, "launch direct")).toMatchObject({ state: "fail", output: ["Error: Cannot find module"] });
  });

  it("fails after the timeout, keeps what the server printed and stops it", async () => {
    await writeClaude({ mcpServers: { libredesk: { command: "npx", args: ["-y", PACKAGE_NAME, "serve"] } } });
    const { deps: d, calls, stop } = deps((command) => (command === EXEC ? ok : { kind: "silent", stderr: "npm warn exec downloading\n" }), { timeoutMs: 40 });
    const report = await runDoctor(d);
    const launch = check(report.checks, "launch libredesk");
    expect(launch).toMatchObject({ state: "fail", detail: "did not answer within 0.04 s", output: ["npm warn exec downloading"] });
    expect(launch.notes).toContain("npx can take longer on its first run; try --timeout 60.");
    expect(stop).toHaveBeenCalledWith(calls[0]?.child);
  });

  it("launches node with the running script when no client config has an entry", async () => {
    const { deps: d, calls } = deps(() => ok);
    const report = await runDoctor(d);
    expect(report.ok).toBe(true);
    expect(report.checks.filter((c) => c.name === "config").map((c) => c.state)).toEqual(["warn", "warn"]);
    const direct = check(report.checks, "launch direct");
    expect(direct.state).toBe("ok");
    expect(direct.notes).toContain("No LibreDesk entry in the client config, so the server was started with node directly.");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ command: EXEC, args: [SCRIPT, "serve"], options: { shell: false } });
  });

  it("warns when the server answers with another version or prints to stdout", async () => {
    await writeClaude({ mcpServers: { libredesk: { command: "ldesk", args: ["serve"] } } });
    const { deps: d } = deps(() => ({ kind: "answer", name: PACKAGE_NAME, version: "0.0.1", stdout: "hello from a shim\n" }));
    const launch = check((await runDoctor(d)).checks, "launch libredesk");
    expect(launch.state).toBe("warn");
    expect(launch.detail).toContain(`this ldesk is ${pkg.version}`);
    expect(launch.detail).toContain("not MCP");
    expect(launch.output).toEqual(["hello from a shim"]);
  });

  it("fails on an initialize error answer", async () => {
    await writeClaude({ mcpServers: { libredesk: { command: "ldesk", args: ["serve"] } } });
    const { deps: d } = deps((command) => (command === EXEC ? ok : { kind: "rpc-error", message: "bad protocol" }));
    expect(check((await runDoctor(d)).checks, "launch libredesk").detail).toBe("answered initialize with an error: bad protocol");
  });

  it("reports a missing profile and an old Node as failures with a fix", async () => {
    const { deps: d } = deps(() => ok, {
      nodeVersion: "v20.11.0",
      status: () => Promise.reject(new NoProfileError("No LibreDesk profile is set up.", { hint: "Run ldesk login." })),
    });
    const report = await runDoctor(d);
    expect(report.ok).toBe(false);
    expect(check(report.checks, "node")).toMatchObject({ state: "fail", fix: ["Install Node.js 22.12.0 or newer."] });
    expect(check(report.checks, "profile")).toMatchObject({ state: "fail", detail: "No LibreDesk profile is set up.", fix: ["Run ldesk login."] });
  });

  it("reports an unreachable server with its hint", async () => {
    const { deps: d } = deps(() => ok, { status: () => Promise.resolve({ ...reachable, reachable: false, agent: undefined, error: "Request failed", hint: "Check the URL." }) });
    expect(check((await runDoctor(d)).checks, "profile")).toMatchObject({ state: "fail", fix: ["Check the URL."] });
  });

  it("names the file the command resolves to", async () => {
    await writeClaude({ mcpServers: { libredesk: { command: "ldesk", args: ["serve"] } } });
    const { deps: d } = deps(() => ok, { env: { PATH: "/a:/b" }, exists: (p) => p === "/b/ldesk" });
    expect(check((await runDoctor(d)).checks, "launch libredesk").notes).toContain("resolves to: /b/ldesk");
  });
});

describe("mcp-probe helpers", () => {
  it("runs an extensionless command through cmd.exe on Windows only, as one quoted command line", () => {
    expect(planSpawn({ command: "ldesk", args: ["serve"], env: {} }, "win32")).toEqual({ command: "ldesk serve", args: [], shell: true });
    expect(planSpawn({ command: "npx", args: ["-y", "@spaceparrots/libredesk-mcp", "serve"], env: {} }, "win32").command).toBe("npx -y @spaceparrots/libredesk-mcp serve");
    expect(planSpawn({ command: "C:\\Program Files\\nodejs\\node", args: ["C:\\My Tools\\index.js"], env: {} }, "win32").command).toBe(
      '"C:\\Program Files\\nodejs\\node" "C:\\My Tools\\index.js"',
    );
    expect(planSpawn({ command: "C:\\nodejs\\node.exe", args: ["x.js"], env: {} }, "win32")).toEqual({ command: "C:\\nodejs\\node.exe", args: ["x.js"], shell: false });
    expect(planSpawn({ command: "ldesk", args: ["serve"], env: {} }, "linux")).toEqual({ command: "ldesk", args: ["serve"], shell: false });
  });

  it("resolves a command on PATH with PATHEXT on Windows, first directory first", () => {
    const files = new Set(["c:\\nvm\\nodejs\\ldesk.exe", "c:\\npm\\ldesk.cmd"]);
    const exists = (p: string) => files.has(p.toLowerCase());
    expect(resolveCommand("ldesk", { Path: "C:\\nvm\\nodejs;C:\\npm" }, "win32", "C:\\", exists)?.toLowerCase()).toBe("c:\\nvm\\nodejs\\ldesk.exe");
    expect(resolveCommand("ldesk", { PATH: "C:\\npm;C:\\nvm\\nodejs" }, "win32", "C:\\", exists)?.toLowerCase()).toBe("c:\\npm\\ldesk.cmd");
    expect(resolveCommand("ldesk", { PATH: "C:\\other" }, "win32", "C:\\", exists)).toBeUndefined();
    expect(resolveCommand("./bin/ldesk", {}, "linux", "/proj", (p) => p === "/proj/bin/ldesk")).toBe("/proj/bin/ldesk");
  });

  it("expands ${VAR} and ${VAR:-default}", () => {
    expect(expandVars("${HOME}/x ${MISSING:-fallback} ${NONE}", { HOME: "/home/k" })).toBe("/home/k/x fallback ");
  });

  it("reports a spawn that throws", async () => {
    const result = await probeLaunch(
      { command: "x", args: [], env: {} },
      {
        timeoutMs: 100,
        cwd: "/",
        baseEnv: {},
        platform: "linux",
        clientVersion: "1",
        spawn: () => {
          throw Object.assign(new Error("spawn EINVAL"), { code: "EINVAL" });
        },
      },
    );
    expect(result).toEqual({ ok: false, reason: "spawn", message: "could not be started: EINVAL", output: [] });
  });

  it("compares versions and quotes command lines for display", () => {
    expect(meetsVersion("v22.12.0", ">=22.12.0")).toBe(true);
    expect(meetsVersion("v24.1.0", "22.12.0")).toBe(true);
    expect(meetsVersion("v22.11.9", "22.12.0")).toBe(false);
    expect(commandLine("C:\\Program Files\\node.exe", ["serve"])).toBe('"C:\\Program Files\\node.exe" serve');
  });
});
