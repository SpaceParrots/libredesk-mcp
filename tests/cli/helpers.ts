import { z } from "zod";
import { defineOperation } from "../../src/ops/define.js";
import type { PromptAdapter } from "../../src/cli/prompt.js";

/** A prompt that fails the test when anything is asked. */
export const neverPrompt: PromptAdapter = {
  text: () => Promise.reject(new Error("unexpected text prompt")),
  password: () => Promise.reject(new Error("unexpected password prompt")),
  confirm: () => Promise.reject(new Error("unexpected confirm prompt")),
  select: () => Promise.reject(new Error("unexpected select prompt")),
  note: () => {
    throw new Error("unexpected note");
  },
};

export const sample = defineOperation({
  name: "thing_save",
  group: "thing",
  summary: "Save a thing.",
  method: "POST",
  path: "/api/v1/things/{id}",
  input: {
    id: z.number().describe("Thing id."),
    title: z.string().describe("Title."),
    theme: z.record(z.string(), z.string()).optional().describe("Theme."),
    ai_enabled: z.boolean().optional(),
    published: z.boolean().default(true),
    allowed_locales: z.array(z.enum(["en", "de"])).optional(),
    mode: z.enum(["a", "b"]).optional(),
    count: z.number().nullable().optional(),
  },
  positional: ["id"],
  impact: "write",
});

/** Split a command line the way a POSIX shell would for the quoting `commandLineFor` produces. */
export function shellSplit(line: string): string[] {
  const tokens: string[] = [];
  let current: string | undefined;
  let i = 0;
  const push = (text: string) => {
    current = (current ?? "") + text;
  };
  while (i < line.length) {
    const ch = line.charAt(i);
    if (ch === " ") {
      if (current !== undefined) tokens.push(current);
      current = undefined;
      i += 1;
    } else if (ch === '"') {
      i += 1;
      current ??= "";
      while (line.charAt(i) !== '"') {
        if (line.charAt(i) === "\\") i += 1;
        push(line.charAt(i));
        i += 1;
      }
      i += 1;
    } else if (ch === "'") {
      i += 1;
      current ??= "";
      while (line.charAt(i) !== "'") {
        push(line.charAt(i));
        i += 1;
      }
      i += 1;
    } else if (ch === "\\") {
      push(line.charAt(i + 1));
      i += 2;
    } else {
      push(ch);
      i += 1;
    }
  }
  if (current !== undefined) tokens.push(current);
  return tokens;
}
