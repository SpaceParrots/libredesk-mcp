import { describe, expect, it, vi } from "vitest";
import { collectMissing, confirmImpact } from "../../src/cli/confirm.js";
import type { PromptAdapter } from "../../src/cli/prompt.js";
import { DOMAINS } from "../../src/domains/index.js";
import { CancelledError, ConfirmationRequiredError, InputError } from "../../src/errors.js";
import type { Operation } from "../../src/ops/define.js";
import { neverPrompt, sample } from "./helpers.js";

function op(domain: string, name: string): Operation {
  const found = DOMAINS.find((d) => d.name === domain)?.operations.find((o) => o.name === name);
  if (!found) throw new Error(`${domain}/${name} not found`);
  return found;
}

const createArticle = op("articles", "create");
const deleteArticle = op("articles", "delete");

describe("collectMissing", () => {
  it("non-TTY run without required fields fails naming the flags", async () => {
    const error = await collectMissing(createArticle, { collection_id: 1 }, { isTTY: false, prompt: neverPrompt }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(InputError);
    expect((error as InputError).message).toMatch(/--title.*--content|--content.*--title/);
  });

  it("returns a copy when nothing is missing", async () => {
    const values = { collection_id: 1, title: "t", content: "c" };
    const result = await collectMissing(createArticle, values, { isTTY: false, prompt: neverPrompt });
    expect(result).toEqual(values);
    expect(result).not.toBe(values);
  });

  it("TTY prompts per missing field by kind", async () => {
    const prompt: PromptAdapter = { ...neverPrompt, text: vi.fn(() => Promise.resolve("7")) };
    const result = await collectMissing(sample, { title: "x" }, { isTTY: true, prompt });
    expect(result).toEqual({ title: "x", id: 7 });
  });

  it("TTY uses a select for enum fields", async () => {
    const enumOp = op("articles", "set_status");
    const select = vi.fn(() => Promise.resolve("published"));
    const prompt = { ...neverPrompt, select, text: () => Promise.resolve("5") } as unknown as PromptAdapter;
    const result = await collectMissing(enumOp, {}, { isTTY: true, prompt });
    expect(select).toHaveBeenCalled();
    expect(Object.values(result)).toContain("published");
  });
});

describe("confirmImpact", () => {
  it("non-TTY destructive op without --yes fails with the effect and a --yes hint", async () => {
    const error = await confirmImpact(deleteArticle, { yes: false, isTTY: false, prompt: neverPrompt }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ConfirmationRequiredError);
    expect((error as ConfirmationRequiredError).message).toBe(deleteArticle.effect);
    expect((error as ConfirmationRequiredError).hint).toContain("--yes");
  });

  it("TTY destructive op asks and a No cancels", async () => {
    const confirm = vi.fn(() => Promise.resolve(false));
    const prompt: PromptAdapter = { ...neverPrompt, confirm };
    await expect(confirmImpact(deleteArticle, { yes: false, isTTY: true, prompt })).rejects.toBeInstanceOf(CancelledError);
    expect(confirm).toHaveBeenCalledWith({ message: deleteArticle.effect, initialValue: false });
  });

  it("TTY Yes proceeds", async () => {
    const prompt: PromptAdapter = { ...neverPrompt, confirm: () => Promise.resolve(true) };
    await expect(confirmImpact(deleteArticle, { yes: false, isTTY: true, prompt })).resolves.toBeUndefined();
  });

  it("--yes skips the prompt", async () => {
    await expect(confirmImpact(deleteArticle, { yes: true, isTTY: true, prompt: neverPrompt })).resolves.toBeUndefined();
    await expect(confirmImpact(deleteArticle, { yes: true, isTTY: false, prompt: neverPrompt })).resolves.toBeUndefined();
  });

  it("read and write ops never prompt", async () => {
    await expect(confirmImpact(op("articles", "get"), { yes: false, isTTY: true, prompt: neverPrompt })).resolves.toBeUndefined();
    await expect(confirmImpact(createArticle, { yes: false, isTTY: false, prompt: neverPrompt })).resolves.toBeUndefined();
  });
});
