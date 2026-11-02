import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { addDomainCommands, type CliDeps } from "../../src/cli/domain-commands.js";
import { getCurrentProfile } from "../../src/context.js";
import { DOMAINS } from "../../src/domains/index.js";
import { ConfirmationRequiredError, InputError } from "../../src/errors.js";
import { runOperation } from "../../src/ops/run.js";
import type { Operation } from "../../src/ops/define.js";
import { neverPrompt } from "./helpers.js";

interface Harness {
  program: Command;
  runs: { op: Operation; values: Record<string, unknown> }[];
  printed: { data: unknown; json: boolean }[];
  errors: unknown[];
}

function harness(overrides: Partial<CliDeps> = {}): Harness {
  const h: Harness = { program: new Command(), runs: [], printed: [], errors: [] };
  h.program.exitOverride();
  const deps: CliDeps = {
    isTTY: false,
    prompt: neverPrompt,
    run: (op, values) => {
      h.runs.push({ op, values: values as Record<string, unknown> });
      return Promise.resolve({ ok: true });
    },
    print: (data, opts) => {
      h.printed.push({ data, json: opts.json });
    },
    onError: (err) => {
      h.errors.push(err);
      throw new Error("exit");
    },
    ...overrides,
  };
  addDomainCommands(h.program, DOMAINS, deps);
  return h;
}

async function exec(h: Harness, ...args: string[]): Promise<void> {
  await h.program.parseAsync(["node", "ldesk", ...args]).catch(() => undefined);
}

describe("addDomainCommands", () => {
  it("builds nested commands and runs the operation with parsed values", async () => {
    const h = harness();
    await exec(h, "help-center", "collection", "create", "--help-center-id", "1", "--name", "FAQ");
    expect(h.runs).toHaveLength(1);
    expect(h.runs[0]?.op.name).toBe("collection_create");
    expect(h.runs[0]?.values).toEqual({ help_center_id: 1, name: "FAQ" });
    expect(h.printed).toEqual([{ data: { ok: true }, json: false }]);
  });

  it("positional args fill their fields and --json is passed on", async () => {
    const h = harness();
    await exec(h, "articles", "get", "42", "--collection-id", "3", "--json");
    expect(h.runs[0]?.op.name).toBe("get");
    expect(h.runs[0]?.values).toEqual({ id: 42, collection_id: 3 });
    expect(h.printed[0]?.json).toBe(true);
  });

  it("passes --profile through withProfile", async () => {
    let seen: string | undefined;
    const h = harness({
      run: async () => {
        // An override skips the env profile, so the lookup of "other" must fail naming it or the config.
        vi.stubEnv("LIBREDESK_URL", "https://x.example");
        vi.stubEnv("LIBREDESK_API_KEY", "k");
        vi.stubEnv("LIBREDESK_API_SECRET", "s");
        vi.stubEnv("LIBREDESK_CONFIG_DIR", "Z:/does-not-exist");
        try {
          await getCurrentProfile();
        } catch (error) {
          seen = (error as Error).message;
        } finally {
          vi.unstubAllEnvs();
        }
        return {};
      },
    });
    await exec(h, "articles", "get", "1", "--collection-id", "1", "--profile", "other");
    expect(seen).toBeDefined();
    expect(seen).toMatch(/other/);
  });

  it("update without --ai-enabled does not send ai_enabled", async () => {
    const h = harness();
    await exec(h, "articles", "update", "42", "--title", "New");
    const values = h.runs[0]?.values ?? {};
    expect(values).toEqual({ id: 42, title: "New" });
    expect("ai_enabled" in values).toBe(false);
  });

  it("--ai-enabled and --no-ai-enabled are sent when given", async () => {
    const h = harness();
    await exec(h, "articles", "update", "42", "--no-ai-enabled");
    await exec(h, "articles", "update", "42", "--ai-enabled");
    expect(h.runs[0]?.values.ai_enabled).toBe(false);
    expect(h.runs[1]?.values.ai_enabled).toBe(true);
  });

  it("a boolean defaulting to true is not injected, --no-x sets false", async () => {
    const h = harness();
    await exec(h, "articles", "create", "--collection-id", "1", "--title", "T", "--content", "C");
    await exec(h, "articles", "create", "--collection-id", "1", "--title", "T", "--content", "C", "--no-ai-enabled");
    expect("ai_enabled" in (h.runs[0]?.values ?? {})).toBe(false);
    expect(h.runs[1]?.values.ai_enabled).toBe(false);
  });

  it("repeated array flags collect values", async () => {
    const h = harness();
    await exec(h, "help-center", "update", "1", "--allowed-locales", "en", "--allowed-locales", "de");
    expect(h.runs[0]?.values.allowed_locales).toEqual(["en", "de"]);
  });

  it("non-TTY destructive op without --yes never runs and reports ConfirmationRequiredError", async () => {
    const h = harness();
    await exec(h, "articles", "delete", "5", "--collection-id", "1");
    expect(h.runs).toHaveLength(0);
    expect(h.errors[0]).toBeInstanceOf(ConfirmationRequiredError);
  });

  it("--yes lets a destructive op run without a TTY", async () => {
    const h = harness();
    await exec(h, "articles", "delete", "5", "--collection-id", "1", "--yes");
    expect(h.runs).toHaveLength(1);
  });

  it("non-TTY missing required fields report an InputError and never prompt", async () => {
    const h = harness();
    await exec(h, "articles", "create", "--collection-id", "1");
    expect(h.runs).toHaveLength(0);
    expect(h.errors[0]).toBeInstanceOf(InputError);
  });

  it("names flags and positionals, not snake_case fields, in input errors", async () => {
    const h = harness({ run: (op, values) => runOperation(op, { ...(values as object), help_center_id: "abc" }) });
    await exec(h, "help-center", "collection", "create", "--help-center-id", "1", "--name", "FAQ");
    const error = h.errors[0] as InputError;
    expect(error).toBeInstanceOf(InputError);
    expect(error.message).toContain("<help-center-id>");
    expect(error.message).not.toContain("help_center_id");
    expect(error.message).toContain("ldesk help-center collection create");
    expect(error.hint).toContain("--help");
    expect(error.hint).not.toContain("help_center_id");
  });

  it("accepts null for nullable fields", async () => {
    const h = harness();
    await exec(h, "help-center", "collection", "update", "5", "--help-center-id", "1", "--parent-id", "null");
    expect(h.runs[0]?.values.parent_id).toBeNull();
  });

  it("fills positionals only into slots not given as flags", async () => {
    const h = harness();
    await exec(h, "help-center", "collection", "update", "--help-center-id", "1", "5", "--name", "x");
    expect(h.runs[0]?.values).toMatchObject({ help_center_id: 1, id: 5, name: "x" });
  });

  it("help shows summary, undocumented marker and effect", () => {
    const h = harness();
    const articles = h.program.commands.find((c) => c.name() === "articles");
    const del = articles?.commands.find((c) => c.name() === "delete");
    const help = del?.helpInformation() ?? "";
    expect(help).toContain("Delete an article.");
    expect(help).toContain("[undocumented API]");
    expect(help).toContain("Deletes the article. Linked translations stay.");
  });
});
