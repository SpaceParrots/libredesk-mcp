/**
 * @module services/mcp-probe
 * Starts an MCP server the way a client does, sends `initialize` and waits for the answer. Used by
 * `ldesk doctor` to see what the client sees when it cannot connect. Spawning and stopping are
 * injectable, so tests never start a process.
 *
 * On Windows a command without an extension runs through the shell (`cmd.exe`), because that is
 * how a name like `ldesk` or `npx` finds its `.exe` or `.cmd` shim on PATH (cmd.exe walks PATH
 * and PATHEXT). Spawning such a name without a shell finds `.exe` and `.com` only, and Node
 * refuses to run a `.cmd` file without one. A command with an extension, or any command on other
 * systems, is spawned directly, as the client does.
 */

import { spawn as nodeSpawn } from "node:child_process";
import { existsSync } from "node:fs";
import { posix, win32 } from "node:path";
import type { Readable, Writable } from "node:stream";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";

/** The parts of a child process the probe uses. `ChildProcess` satisfies it. */
export interface ChildLike {
  readonly pid?: number | undefined;
  readonly stdin: Writable | null;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
}

/** Options the probe passes to {@link SpawnFn}. */
export interface ProbeSpawnOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly shell: boolean;
  readonly windowsHide: true;
  readonly stdio: "pipe";
}

/** Starts a process. Defaults to `child_process.spawn`. */
export type SpawnFn = (command: string, args: readonly string[], options: ProbeSpawnOptions) => ChildLike;

/** Stops a started process by its own PID (and, on Windows, the processes it started). */
export type StopFn = (child: ChildLike) => void;

/** What to start: the command, args and env of a client entry, after `${VAR}` expansion. */
export interface LaunchSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/** Inputs of {@link probeLaunch}. */
export interface ProbeOptions {
  readonly timeoutMs: number;
  readonly cwd: string;
  /** Environment the client would pass on; the entry's env is merged over it. */
  readonly baseEnv: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly clientVersion: string;
  readonly spawn?: SpawnFn;
  readonly stop?: StopFn;
}

/** The outcome of one launch. */
export type ProbeResult =
  | { readonly ok: true; readonly serverName: string; readonly serverVersion: string; readonly strayOutput: readonly string[] }
  | { readonly ok: false; readonly reason: "spawn" | "exit" | "timeout" | "rpc"; readonly message: string; readonly output: readonly string[] };

/** How many lines of the child's output a failure keeps. */
const OUTPUT_LINES = 8;
const REQUEST_ID = 1;

const defaultSpawn: SpawnFn = (command, args, options) => nodeSpawn(command, [...args], options);

/**
 * Stop a probed process. On Windows `taskkill /T` ends the child by its PID together with what it
 * started, because the child is often `cmd.exe` or a shim whose node process would outlive it.
 */
export const defaultStop: StopFn = (child) => {
  child.stdin?.end();
  if (process.platform === "win32" && child.pid !== undefined) {
    nodeSpawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => child.kill());
    return;
  }
  child.kill();
};

function quoteForCmd(arg: string): string {
  return /^[\w\-.:\\/@=+,]+$/.test(arg) ? arg : `"${arg.replaceAll('"', '""')}"`;
}

/** How the probe spawns `spec` on `platform`: through the shell only on Windows for a command without extension. */
export function planSpawn(spec: LaunchSpec, platform: NodeJS.Platform): { command: string; args: readonly string[]; shell: boolean } {
  if (platform === "win32" && win32.extname(spec.command) === "") {
    // One command line instead of args, because Node does not quote args for the shell.
    return { command: [spec.command, ...spec.args].map(quoteForCmd).join(" "), args: [], shell: true };
  }
  return { command: spec.command, args: spec.args, shell: false };
}

/** Expand `${VAR}` and `${VAR:-default}` the way Claude Code does in MCP configs. */
export function expandVars(text: string, env: NodeJS.ProcessEnv): string {
  return text.replaceAll(/\$\{([A-Za-z_]\w*)(?::-([^}]*))?\}/g, (_match, name: string, fallback: string | undefined) => env[name] ?? fallback ?? "");
}

function envValue(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string | undefined {
  if (platform !== "win32") return env[name];
  const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : env[key];
}

/**
 * The file a command name resolves to on PATH, as the shell would find it, or `undefined`. A
 * command with a path separator is resolved against `cwd`.
 */
export function resolveCommand(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  cwd: string,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  const path = platform === "win32" ? win32 : posix;
  const extensions = platform === "win32" && path.extname(command) === ""
    ? (envValue(env, "PATHEXT", platform) ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean).map((ext) => ext.toLowerCase())
    : [""];
  if (/[\\/]/.test(command)) {
    const base = path.resolve(cwd, command);
    return extensions.map((ext) => base + ext).find((candidate) => exists(candidate));
  }
  const dirs = (envValue(env, "PATH", platform) ?? "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, command + ext);
      if (exists(candidate)) return candidate;
    }
  }
  return undefined;
}

function initializeRequest(clientVersion: string): string {
  return `${JSON.stringify({
    jsonrpc: "2.0",
    id: REQUEST_ID,
    method: "initialize",
    params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "ldesk-doctor", version: clientVersion } },
  })}\n`;
}

function parseMessage(line: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function serverInfo(result: unknown): { name: string; version: string } {
  const info = typeof result === "object" && result !== null ? (result as Record<string, unknown>).serverInfo : undefined;
  const record = typeof info === "object" && info !== null ? (info as Record<string, unknown>) : {};
  return { name: typeof record.name === "string" ? record.name : "unknown", version: typeof record.version === "string" ? record.version : "unknown" };
}

function rpcErrorMessage(error: unknown): string {
  const message = typeof error === "object" && error !== null ? (error as Record<string, unknown>).message : undefined;
  return typeof message === "string" ? message : "unknown error";
}

/**
 * Start `spec`, send `initialize`, and resolve with the server's answer or why there was none:
 * the process could not start, exited, timed out, or answered with an error. The process is
 * stopped before the promise resolves. Never rejects.
 */
export function probeLaunch(spec: LaunchSpec, options: ProbeOptions): Promise<ProbeResult> {
  const plan = planSpawn(spec, options.platform);
  const stop = options.stop ?? defaultStop;
  return new Promise((resolve) => {
    const output: string[] = [];
    const stray: string[] = [];
    const keep = (line: string, into: string[]) => {
      if (line.trim() === "") return;
      into.push(line.trimEnd());
      if (into.length > OUTPUT_LINES) into.shift();
    };
    let child: ChildLike;
    try {
      child = (options.spawn ?? defaultSpawn)(plan.command, plan.args, {
        env: { ...options.baseEnv, ...spec.env },
        cwd: options.cwd,
        shell: plan.shell,
        windowsHide: true,
        stdio: "pipe",
      });
    } catch (error) {
      resolve({ ok: false, reason: "spawn", message: `could not be started: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}`, output: [] });
      return;
    }
    let settled = false;
    let closed = false;
    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!closed) stop(child);
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish({ ok: false, reason: "timeout", message: `did not answer within ${options.timeoutMs / 1000} s`, output: [...output, ...stray].slice(-OUTPUT_LINES) });
    }, options.timeoutMs);

    let buffer = "";
    child.stdout?.on("data", (chunk: Buffer | string) => {
      buffer += String(chunk);
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const message = parseMessage(line);
        if (message?.id !== REQUEST_ID) {
          // Anything else on stdout is not protocol and would confuse the client.
          if (message === undefined) keep(line, stray);
          continue;
        }
        if (message.error !== undefined) {
          finish({ ok: false, reason: "rpc", message: `answered initialize with an error: ${rpcErrorMessage(message.error)}`, output: [...output, ...stray].slice(-OUTPUT_LINES) });
        } else {
          const info = serverInfo(message.result);
          finish({ ok: true, serverName: info.name, serverVersion: info.version, strayOutput: stray });
        }
      }
    });
    let errBuffer = "";
    child.stderr?.on("data", (chunk: Buffer | string) => {
      errBuffer += String(chunk);
      const lines = errBuffer.split("\n");
      errBuffer = lines.pop() ?? "";
      for (const line of lines) keep(line, output);
    });
    child.on("error", (error) => {
      finish({ ok: false, reason: "spawn", message: `could not be started: ${(error as NodeJS.ErrnoException).code ?? error.message}`, output: [...output, ...stray].slice(-OUTPUT_LINES) });
    });
    child.on("close", (code, signal) => {
      closed = true;
      keep(errBuffer, output);
      keep(buffer, stray);
      const how = code === null ? `was stopped by ${signal ?? "a signal"}` : `exited with code ${code}`;
      finish({ ok: false, reason: "exit", message: `${how} before answering`, output: [...output, ...stray].slice(-OUTPUT_LINES) });
    });
    // A child that exits early closes stdin; the write error is reported through "close".
    child.stdin?.on("error", () => undefined);
    child.stdin?.write(initializeRequest(options.clientVersion));
  });
}
