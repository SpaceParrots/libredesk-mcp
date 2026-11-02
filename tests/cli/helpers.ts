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
    count: z.number().optional(),
  },
  positional: ["id"],
  impact: "write",
});
