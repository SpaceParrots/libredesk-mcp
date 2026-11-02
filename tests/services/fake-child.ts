import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { vi } from "vitest";
import type { ChildLike, ProbeSpawnOptions, SpawnFn } from "../../src/services/mcp-probe.js";

/** How a fake server behaves once started. */
export type Behaviour =
  | { readonly kind: "answer"; readonly name: string; readonly version: string; readonly stdout?: string; readonly stderr?: string }
  | { readonly kind: "rpc-error"; readonly message: string }
  | { readonly kind: "crash"; readonly code: number; readonly stderr?: string; readonly stdout?: string }
  | { readonly kind: "silent"; readonly stderr?: string }
  | { readonly kind: "spawn-error"; readonly code: string };

/** A child process made of streams; nothing is started. */
export class FakeChild extends EventEmitter {
  readonly pid = 4242;
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => true);
  /** What the probe wrote to stdin. */
  received = "";
}

/** One recorded spawn call. */
export interface SpawnCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: ProbeSpawnOptions;
  readonly child: FakeChild;
}

function start(child: FakeChild, behaviour: Behaviour): void {
  const later = (fn: () => void) => setTimeout(fn, 1);
  switch (behaviour.kind) {
    case "answer":
    case "rpc-error":
      child.stdin.on("data", (chunk: Buffer) => {
        child.received += String(chunk);
        const request = JSON.parse(String(chunk)) as { id: number };
        if (behaviour.kind === "answer") {
          if (behaviour.stderr) child.stderr.write(behaviour.stderr);
          if (behaviour.stdout) child.stdout.write(behaviour.stdout);
          const result = { protocolVersion: "2025-11-25", capabilities: {}, serverInfo: { name: behaviour.name, version: behaviour.version } };
          child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
        } else {
          child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32_603, message: behaviour.message } })}\n`);
        }
      });
      return;
    case "crash":
      later(() => {
        if (behaviour.stderr) child.stderr.write(behaviour.stderr);
        if (behaviour.stdout) child.stdout.write(behaviour.stdout);
        later(() => child.emit("close", behaviour.code, null));
      });
      return;
    case "silent":
      if (behaviour.stderr) later(() => child.stderr.write(behaviour.stderr));
      return;
    case "spawn-error":
      later(() => child.emit("error", Object.assign(new Error(`spawn ${behaviour.code}`), { code: behaviour.code })));
      return;
  }
}

/** A spawn function that records its calls and starts a {@link FakeChild} with the behaviour `pick` returns. */
export function fakeSpawn(pick: (command: string, args: readonly string[]) => Behaviour): { spawn: SpawnFn; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  const spawn: SpawnFn = (command, args, options) => {
    const child = new FakeChild();
    calls.push({ command, args, options, child });
    start(child, pick(command, args));
    return child as unknown as ChildLike;
  };
  return { spawn, calls };
}
