import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createProgram } from "../../src/cli/program.js";
import { DOMAINS } from "../../src/domains/index.js";
import type { Operation } from "../../src/ops/define.js";
import { neverPrompt, shellSplit } from "./helpers.js";

let dir: string;
let cwd: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ldesk-examples-"));
  cwd = process.cwd();
});

afterAll(async () => {
  process.chdir(cwd);
  await rm(dir, { recursive: true, force: true });
});

/** Create every `@file` an example reads, so the example parses as written. */
async function createReferencedFiles(tokens: readonly string[]): Promise<void> {
  for (const token of tokens) {
    const value = token.includes("=") ? token.slice(token.indexOf("=") + 1) : token;
    if (value.startsWith("@") && !value.startsWith("@@")) await writeFile(join(dir, value.slice(1)), "{}");
  }
}

/** Parse an example without a terminal and return the operation it ran, or throw what failed. */
async function runExample(line: string): Promise<Operation | undefined> {
  const tokens = shellSplit(line);
  await createReferencedFiles(tokens);
  let ran: Operation | undefined;
  const program = createProgram({
    isTTY: false,
    prompt: neverPrompt,
    run: (op) => {
      ran = op;
      return Promise.resolve({});
    },
    print: () => undefined,
    onError: (error) => {
      throw error;
    },
  });
  program.exitOverride();
  program.configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
  const stderr: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error(stderr.join("").trim() || "exit");
  });
  process.chdir(dir);
  try {
    await program.parseAsync(["node", ...tokens]);
  } finally {
    process.chdir(cwd);
    vi.restoreAllMocks();
  }
  return ran;
}

describe("cli examples", () => {
  for (const domain of DOMAINS) {
    for (const op of domain.operations) {
      it(`${domain.name} ${op.name} has one to three examples that run it without a terminal`, async () => {
        const examples = op.cli?.examples ?? [];
        expect(examples.length).toBeGreaterThanOrEqual(1);
        expect(examples.length).toBeLessThanOrEqual(3);
        for (const example of examples) {
          expect(example).toMatch(/^[\x20-\x7E]+$/);
          expect(await runExample(example), example).toBe(op);
        }
      });
    }
  }
});
