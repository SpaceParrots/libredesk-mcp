/**
 * @module services/doctor
 * The checks behind `ldesk doctor`: Node, the running script, the profile and its server, the
 * MCP client configs, and a launch of every LibreDesk entry the way the client starts it. No
 * printing here. Env values from client configs never reach the report, only their key names.
 */

import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { resolve as resolvePath } from "node:path";
import { PACKAGE_NAME } from "../constants.js";
import { toLibreDeskError } from "../errors.js";
import { redactText } from "../mask.js";
import { discoverClientConfigs, type ClientEntry, type ConfigFileReport } from "./client-config.js";
import { expandVars, probeLaunch, resolveCommand, type LaunchSpec, type ProbeResult, type SpawnFn, type StopFn } from "./mcp-probe.js";
import { getStatus, type StatusReport } from "./status.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string; engines?: { node?: string } };

/** Result of one check. */
export type CheckState = "ok" | "warn" | "fail";

/** One line of the doctor report. */
export interface DoctorCheck {
  readonly name: string;
  readonly state: CheckState;
  readonly detail: string;
  /** Facts behind the detail: command, scope, env key names, resolved path. */
  readonly notes?: readonly string[];
  /** Last lines the server printed, secrets redacted. */
  readonly output?: readonly string[];
  /** Commands or steps that fix a failure. */
  readonly fix?: readonly string[];
}

/** What `ldesk doctor` prints. `ok` is false when any check failed. */
export interface DoctorReport {
  readonly ok: boolean;
  readonly checks: readonly DoctorCheck[];
}

/** Dependencies of {@link runDoctor}; each defaults to the process state, so tests can replace them. */
export interface DoctorDeps {
  /** Profile name for the profile check, as `--profile`. */
  readonly profile?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  readonly homeDir?: string;
  readonly platform?: NodeJS.Platform;
  readonly nodeVersion?: string;
  readonly execPath?: string;
  /** The running `ldesk` script, resolved. Defaults to the real path of `process.argv[1]`. */
  readonly scriptPath?: string;
  readonly status?: () => Promise<StatusReport>;
  readonly readText?: (path: string) => Promise<string | undefined>;
  readonly exists?: (path: string) => boolean;
  readonly spawn?: SpawnFn;
  readonly stop?: StopFn;
  /** How long each launch may take to answer `initialize`. */
  readonly timeoutMs?: number;
  /**
   * Whether to start an entry of `./.mcp.json`, given its name and command line. That file comes
   * with the folder, for example a cloned repo, so its command is not run unless this says yes.
   * Defaults to no.
   */
  readonly trustProject?: (name: string, command: string) => Promise<boolean>;
}

const NO_TRUST = (): Promise<boolean> => Promise.resolve(false);

/** Default wait for a launched server's answer. */
export const DEFAULT_LAUNCH_TIMEOUT_MS = 10_000;

/** Env keys of a client entry whose values are shown nowhere, but redacted from server output. */
const SECRET_KEY = /secret|key|token|password|auth/i;

/** Resolve the running script: absolute, symlinks followed. Empty when there is none. */
export function resolveScriptPath(arg: string | undefined = process.argv[1]): string {
  if (arg === undefined || arg === "") return "";
  const absolute = resolvePath(arg);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

function versionParts(version: string): number[] {
  return version.replace(/^[^\d]*/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
}

/** True when `version` is at least `minimum` (both `x.y.z`, an optional leading `v` or `>=`). */
export function meetsVersion(version: string, minimum: string): boolean {
  const have = versionParts(version);
  const need = versionParts(minimum);
  for (let i = 0; i < 3; i += 1) {
    const a = have[i] ?? 0;
    const b = need[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

function quote(arg: string): string {
  return /[\s"]/.test(arg) || arg === "" ? `"${arg.replaceAll('"', '\\"')}"` : arg;
}

/** A command line for display. */
export function commandLine(command: string, args: readonly string[]): string {
  return [command, ...args].map(quote).join(" ");
}

function nodeCheck(nodeVersion: string, execPath: string): DoctorCheck {
  const minimum = (pkg.engines?.node ?? ">=22.12.0").replace(/^>=\s*/, "");
  const detail = `${nodeVersion} at ${execPath}`;
  if (meetsVersion(nodeVersion, minimum)) return { name: "node", state: "ok", detail };
  return { name: "node", state: "fail", detail: `${detail}, needs ${minimum} or newer`, fix: [`Install Node.js ${minimum} or newer.`] };
}

function scriptCheck(scriptPath: string): DoctorCheck {
  if (scriptPath === "") return { name: "script", state: "warn", detail: "the path of the running ldesk script is unknown" };
  return { name: "script", state: "ok", detail: scriptPath };
}

async function profileCheck(status: () => Promise<StatusReport>): Promise<DoctorCheck> {
  try {
    const report = await status();
    const where = `${report.profile} (${report.source}), ${report.url}, key ${report.apiKey}`;
    if (report.reachable) return { name: "profile", state: "ok", detail: `${where}, agent ${report.agent ?? "unknown"}` };
    return {
      name: "profile",
      state: "fail",
      detail: `${where}, server not reachable: ${report.error ?? "unknown error"}`,
      ...(report.hint === undefined ? {} : { fix: [report.hint] }),
    };
  } catch (error) {
    const failure = toLibreDeskError(error);
    return { name: "profile", state: "fail", detail: failure.message, fix: [failure.hint ?? "Run ldesk login."] };
  }
}

function configCheck(file: ConfigFileReport): DoctorCheck {
  const name = "config";
  if (file.state === "missing") return { name, state: "warn", detail: `${file.file} not found` };
  if (file.state === "invalid") return { name, state: "warn", detail: `${file.file} ${file.problem ?? "could not be read"}, skipped` };
  const found = file.matched.length === 0 ? "no LibreDesk entry" : `LibreDesk entries: ${file.matched.join(", ")}`;
  const notStdio = file.notStdio.length === 0 ? "" : `; not started over stdio, so not launched: ${file.notStdio.join(", ")}`;
  return { name, state: file.notStdio.length === 0 ? "ok" : "warn", detail: `${file.file}: ${found}${notStdio}` };
}

interface LaunchContext {
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly platform: NodeJS.Platform;
  readonly exists?: (path: string) => boolean;
  readonly spawn?: SpawnFn;
  readonly stop?: StopFn;
  readonly timeoutMs: number;
}

function probe(spec: LaunchSpec, ctx: LaunchContext): Promise<ProbeResult> {
  return probeLaunch(spec, {
    timeoutMs: ctx.timeoutMs,
    cwd: ctx.cwd,
    baseEnv: ctx.env,
    platform: ctx.platform,
    clientVersion: pkg.version,
    ...(ctx.spawn ? { spawn: ctx.spawn } : {}),
    ...(ctx.stop ? { stop: ctx.stop } : {}),
  });
}

function expandEntry(entry: ClientEntry, env: NodeJS.ProcessEnv): LaunchSpec {
  return {
    command: expandVars(entry.command, env),
    args: entry.args.map((arg) => expandVars(arg, env)),
    env: Object.fromEntries(Object.entries(entry.env).map(([key, value]) => [key, expandVars(value, env)])),
  };
}

function secretsOf(spec: LaunchSpec): string[] {
  return Object.entries(spec.env)
    .filter(([key, value]) => SECRET_KEY.test(key) && value.length > 0)
    .map(([, value]) => value);
}

function outcome(name: string, result: ProbeResult, notes: readonly string[], secrets: readonly string[]): DoctorCheck {
  const redact = (lines: readonly string[]) => lines.map((line) => redactText(line, secrets));
  if (!result.ok) {
    const timeoutNote = result.reason === "timeout" ? ["npx can take longer on its first run; try --timeout 60."] : [];
    return { name, state: "fail", detail: result.message, notes: [...notes, ...timeoutNote], output: redact(result.output) };
  }
  const answered = `answered as ${result.serverName} ${result.serverVersion}`;
  const warnings: string[] = [];
  if (result.serverName !== PACKAGE_NAME) warnings.push(`expected ${PACKAGE_NAME}`);
  else if (result.serverVersion !== pkg.version) warnings.push(`this ldesk is ${pkg.version}`);
  if (result.strayOutput.length > 0) warnings.push("printed text on stdout that is not MCP, which can break the client");
  if (warnings.length === 0) return { name, state: "ok", detail: answered, notes };
  return { name, state: "warn", detail: `${answered}, ${warnings.join("; ")}`, notes, output: redact(result.strayOutput) };
}

function directSpec(execPath: string, scriptPath: string): LaunchSpec {
  return { command: execPath, args: [scriptPath, "serve"], env: {} };
}

/** The `claude mcp add` line that starts the server with this node and this script, and what to run before it. */
export function fixLines(entry: ClientEntry, execPath: string, scriptPath: string): string[] {
  // A project entry (.mcp.json) is shared; a local entry overrides it for this folder only.
  const scope = entry.scope === "project" ? "local" : entry.scope;
  const envFlags = Object.keys(entry.env).map((key) => ` -e ${key}=<${key}>`).join("");
  const add = `claude mcp add --scope ${scope} ${entry.name}${envFlags} -- "${execPath}" "${scriptPath}" serve`;
  const lines = entry.scope === "project" ? [`Override the .mcp.json entry for this folder:`, add] : [`claude mcp remove --scope ${scope} ${entry.name}`, add];
  if (envFlags !== "") lines.push("Fill in the -e values from the current entry.");
  return lines;
}

/**
 * Run every check. Never throws for a failing check; the report says what failed and how to fix
 * it. A launch that fails is compared with a direct `node <script> serve` launch, and when that
 * one works the fix is the `claude mcp add` line that uses it.
 */
export async function runDoctor(deps: DoctorDeps = {}): Promise<DoctorReport> {
  const env = deps.env ?? process.env;
  const cwd = deps.cwd ?? process.cwd();
  const platform = deps.platform ?? process.platform;
  const execPath = deps.execPath ?? process.execPath;
  const scriptPath = deps.scriptPath ?? resolveScriptPath();
  const ctx: LaunchContext = {
    env,
    cwd,
    platform,
    timeoutMs: deps.timeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS,
    ...(deps.exists ? { exists: deps.exists } : {}),
    ...(deps.spawn ? { spawn: deps.spawn } : {}),
    ...(deps.stop ? { stop: deps.stop } : {}),
  };
  const checks: DoctorCheck[] = [nodeCheck(deps.nodeVersion ?? process.version, execPath), scriptCheck(scriptPath)];
  checks.push(await profileCheck(deps.status ?? (() => getStatus({ profile: deps.profile, env }))));

  const configs = await discoverClientConfigs({
    homeDir: deps.homeDir ?? homedir(),
    cwd,
    env,
    platform,
    scriptPath,
    ...(deps.readText ? { readText: deps.readText } : {}),
  });
  checks.push(...configs.files.map(configCheck));

  const direct = directSpec(execPath, scriptPath);
  const directNotes = [`command: ${commandLine(direct.command, direct.args)}`];
  let directResult: ProbeResult | undefined;
  const runDirect = async () => (directResult ??= await probe(direct, ctx));

  if (configs.entries.length === 0) {
    const check = outcome("launch direct", await runDirect(), directNotes, []);
    checks.push({ ...check, notes: [...(check.notes ?? []), "No LibreDesk entry in the client config, so the server was started with node directly."] });
    return { ok: checks.every((c) => c.state !== "fail"), checks };
  }

  for (const entry of configs.entries) {
    const spec = expandEntry(entry, env);
    const resolved = resolveCommand(spec.command, { ...env, ...spec.env }, platform, cwd, deps.exists);
    const notes = [
      `command: ${commandLine(spec.command, spec.args)}`,
      `from: ${entry.scope} scope, ${entry.file}`,
      ...(Object.keys(spec.env).length > 0 ? [`env keys: ${Object.keys(spec.env).join(", ")}`] : []),
      `resolves to: ${resolved ?? "nothing on PATH"}`,
    ].map((note) => redactText(note, secretsOf(spec)));
    if (entry.scope === "project" && !(await (deps.trustProject ?? NO_TRUST)(entry.name, redactText(commandLine(spec.command, spec.args), secretsOf(spec))))) {
      checks.push({
        name: `launch ${entry.name}`,
        state: "warn",
        detail: "not started: the command comes from ./.mcp.json in this folder",
        notes,
        fix: ["Check the command above, then run ldesk doctor in a terminal and confirm, or pass --yes."],
      });
      continue;
    }
    const check = outcome(`launch ${entry.name}`, await probe(spec, ctx), notes, secretsOf(spec));
    if (check.state !== "fail") {
      checks.push(check);
      continue;
    }
    if (scriptPath === "") {
      checks.push({ ...check, fix: ["The path of the running ldesk script is unknown, so no direct launch was tried."] });
      continue;
    }
    const fix = (await runDirect()).ok
      ? fixLines(entry, execPath, scriptPath)
      : ["The server does not start with node directly either; see launch direct."];
    checks.push({ ...check, fix });
  }
  // Shown whenever it ran, as the evidence behind the fix.
  if (directResult !== undefined) checks.push(outcome("launch direct", directResult, directNotes, []));
  return { ok: checks.every((c) => c.state !== "fail"), checks };
}
