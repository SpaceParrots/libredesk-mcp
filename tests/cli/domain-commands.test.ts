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

  it("help shows the summary and the confirmation line, without a per-command undocumented marker", () => {
    const help = helpOf(harness(), "articles", "delete");
    expect(help).toContain("Delete an article.");
    expect(help).not.toContain("[undocumented API]");
    expect(help).toContain("Asks for confirmation: Deletes the article. Linked translations stay.");
  });

  it("says once in the domain help that the endpoints are undocumented", () => {
    const help = flat(helpOf(harness(), "articles"));
    expect(help).toContain("Uses LibreDesk endpoints that are not in the public API docs (built against 2.9.2).");
    expect(help).not.toContain("[undocumented API]");
  });

  it("renders examples and notes after the options", () => {
    const help = helpOf(harness(), "help-center", "list");
    const options = help.indexOf("Options:");
    const notes = help.indexOf("Notes:");
    const examples = help.indexOf("Examples:");
    expect(options).toBeGreaterThan(-1);
    expect(notes).toBeGreaterThan(options);
    expect(examples).toBeGreaterThan(notes);
    expect(help).toMatch(/Examples:\n {2}ldesk help-center list\n/);
  });

  it("lists --yes only on commands that may ask for confirmation", () => {
    const h = harness();
    expect(helpOf(h, "help-center", "list")).not.toContain("--yes");
    expect(helpOf(h, "articles", "update")).not.toContain("--yes");
    expect(flat(helpOf(h, "articles", "delete"))).toContain("--yes confirm without asking (required when no terminal is attached)");
    expect(helpOf(h, "articles", "create")).toContain("--yes");
  });

  it("still accepts --yes on commands that never ask", async () => {
    const h = harness();
    await exec(h, "help-center", "list", "--yes");
    expect(h.runs).toHaveLength(1);
  });

  it("shows the flag a user passes for booleans, with a matching description", () => {
    const h = harness();
    const create = flat(helpOf(h, "articles", "create"));
    expect(create).toContain("--no-ai-enabled Do not let AI assistants answer from it once published. (ai-enabled is on by default)");
    expect(create).not.toContain("--ai-enabled ");
    const collection = flat(helpOf(h, "help-center", "collection", "create"));
    expect(collection).toContain("--is-published Publish the collection. New collections start unpublished. (off by default)");
    expect(collection).not.toContain("--no-is-published");
    const update = flat(helpOf(h, "help-center", "collection", "update"));
    expect(update).toContain("--is-published Publish the collection.");
    expect(update).toContain("--no-is-published Do not publish the collection.");
    for (const help of [create, collection, update]) expect(help).not.toMatch(/\(default: (true|false)\)/);
  });

  it("shows required positionals as <name> in usage, arguments and the group listing", () => {
    const h = harness();
    const update = helpOf(h, "help-center", "collection", "update");
    expect(update).toContain("help-center collection update [options] <help-center-id> <id>\n");
    expect(flat(update)).toContain("<help-center-id> Help center id. (required; also --help-center-id <value>)");
    expect(flat(update)).toContain("<id> Collection id. (required; also --id <value>)");
    expect(update.match(/\(required;/g)).toHaveLength(2);
    expect(helpOf(h, "help-center", "collection")).toMatch(/\n {2}update \[options\] <help-center-id> <id> +/);
  });

  it("leaves hidden fields out of the help but accepts them", async () => {
    const h = harness();
    expect(helpOf(h, "articles", "get")).not.toContain("--collection-id");
    expect(helpOf(h, "articles", "delete")).not.toContain("--collection-id");
    await exec(h, "articles", "get", "42", "--collection-id", "3");
    expect(h.runs[0]?.values).toEqual({ id: 42, collection_id: 3 });
  });

  it("lists one-line summaries in group listings, without effect lines", () => {
    const listing = helpOf(harness(), "help-center", "collection");
    expect(listing).not.toContain("Effect:");
    expect(listing).not.toContain("Asks for confirmation");
    expect(listing).toMatch(/\n {2}delete \[options\] <help-center-id> <id> +Delete a collection\.\n/);
    expect(listing).not.toContain("collection commands");
  });

  it("names sibling commands, not MCP actions, and states a default once", () => {
    const h = harness();
    const update = flat(helpOf(h, "articles", "update"));
    expect(update).toContain("Publish with set-status");
    expect(update).not.toContain("set_status");
    expect(flat(helpOf(h, "articles"))).not.toContain("set_status");
    const get = flat(helpOf(h, "articles", "get"));
    expect(get).toContain('"markdown" (default)');
    expect(get).not.toContain("(default: markdown)");
  });

  it("says Pass null to clear it for nullable fields", () => {
    expect(helpOf(harness(), "help-center", "collection", "update")).toMatch(/--parent-id <value>[^]*Pass null to clear it\./);
  });

  it("non-TTY create with status published needs --yes, like set_status", async () => {
    const h = harness();
    await exec(h, "articles", "create", "7", "--title", "T", "--content", "C", "--status", "published");
    expect(h.runs).toHaveLength(0);
    expect(h.errors[0]).toBeInstanceOf(ConfirmationRequiredError);
    expect((h.errors[0] as Error).message).toContain("public");
    await exec(h, "articles", "create", "7", "--title", "T", "--content", "C", "--status", "published", "--yes");
    expect(h.runs).toHaveLength(1);
  });

  it("create as draft never asks", async () => {
    const h = harness({ isTTY: true });
    await exec(h, "articles", "create", "7", "--title", "T", "--content", "C");
    await exec(h, "articles", "create", "7", "--title", "T", "--content", "C", "--status", "draft");
    expect(h.errors).toEqual([]);
    expect(h.runs).toHaveLength(2);
  });

  it("create help says when it asks for confirmation", () => {
    expect(flat(helpOf(harness(), "articles", "create"))).toContain("Asks for confirmation when status is published: Publishing makes the article public");
  });

  it("article help hides the ignored slug and says where the locale default applies", () => {
    const create = flat(helpOf(harness(), "articles", "create"));
    const update = flat(helpOf(harness(), "articles", "update"));
    expect(create).not.toContain("--slug");
    expect(update).not.toContain("--slug");
    expect(create).toContain('Without --locale the article is "en".');
    expect(update).not.toContain('"en"');
  });
});

function helpOf(h: Harness, ...path: string[]): string {
  let command: Command | undefined = h.program;
  for (const name of path) command = command?.commands.find((c) => c.name() === name);
  if (command === undefined) throw new Error(`no command ${path.join(" ")}`);
  return command.helpInformation();
}

/** Help text with every run of whitespace collapsed, so wrapping does not matter. */
function flat(help: string): string {
  return help.replaceAll(/\s+/g, " ");
}
