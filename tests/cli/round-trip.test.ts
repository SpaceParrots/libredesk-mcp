import { describe, expect, it, vi } from "vitest";
import { commandLineFor } from "../../src/cli/interactive.js";
import { createProgram } from "../../src/cli/program.js";
import { DOMAINS } from "../../src/domains/index.js";
import type { Operation } from "../../src/ops/define.js";
import { operationFields, type FieldInfo } from "../../src/ops/fields.js";
import { neverPrompt, shellSplit } from "./helpers.js";

function scalar(info: FieldInfo, variant: "tricky" | "plain"): unknown {
  switch (info.kind) {
    case "number":
      return variant === "tricky" ? 7 : 12;
    case "boolean":
      return variant === "plain";
    case "enum":
      return (info.enumValues ?? [])[variant === "tricky" ? 0 : (info.enumValues?.length ?? 1) - 1];
    case "json":
      return { a: variant === "tricky" ? "it's" : "b", n: [1] };
    default:
      return variant === "tricky" ? '-lead "quoted" $x `y` @file' : "plain";
  }
}

function valuesFor(op: Operation, variant: "tricky" | "plain"): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const info of operationFields(op)) {
    if (info.nullable && variant === "tricky" && info.kind !== "boolean") values[info.name] = null;
    else if (info.array) values[info.name] = [scalar(info, variant), scalar(info, "plain")];
    else values[info.name] = scalar(info, variant);
  }
  return values;
}

async function parseBack(line: string): Promise<Record<string, unknown> | undefined> {
  let received: Record<string, unknown> | undefined;
  const program = createProgram({
    isTTY: false,
    prompt: neverPrompt,
    run: (_op, values) => {
      received = values as Record<string, unknown>;
      return Promise.resolve({});
    },
    print: () => undefined,
    onError: (error) => {
      throw error;
    },
  });
  program.exitOverride();
  program.configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
  // Commander exits the process on a parse error in subcommands; turn that into a readable failure.
  const stderr: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error(stderr.join("").trim() || "exit");
  });
  try {
    await program.parseAsync(["node", ...shellSplit(`${line} --yes`)]);
  } finally {
    vi.restoreAllMocks();
  }
  return received;
}

describe("interactive command line round trip", () => {
  for (const domain of DOMAINS) {
    for (const op of domain.operations) {
      for (const variant of ["tricky", "plain"] as const) {
        it(`${domain.name} ${op.name} (${variant}) parses back to the same values`, async () => {
          const values = valuesFor(op, variant);
          const line = commandLineFor(domain, op, values);
          expect(await parseBack(line), line).toEqual(values);
        });
      }
    }
  }
});
