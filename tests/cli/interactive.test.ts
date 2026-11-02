import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { commandLineFor, runInteractive } from "../../src/cli/interactive.js";
import type { CliDeps } from "../../src/cli/domain-commands.js";
import type { PromptAdapter } from "../../src/cli/prompt.js";
import { DOMAINS } from "../../src/domains/index.js";
import { ApiError, CancelledError } from "../../src/errors.js";
import { defineDomain, defineOperation, type Domain, type Operation } from "../../src/ops/define.js";

const helpCenter = DOMAINS.find((d) => d.name === "help-center") as Domain;
const collectionCreate = helpCenter.operations.find((o) => o.name === "collection_create") as Operation;
const articles = DOMAINS.find((d) => d.name === "articles") as Domain;
const articleGet = articles.operations.find((o) => o.name === "get") as Operation;

const wipe = defineOperation({
  name: "wipe",
  summary: "Wipe a thing.",
  method: "POST",
  path: "/api/v1/things/{id}",
  input: {
    id: z.number(),
    note: z.string().optional().describe("A note."),
    tags: z.array(z.string()).optional(),
    meta: z.record(z.string(), z.string()).optional(),
  },
  positional: ["id"],
  impact: "destructive",
  effect: "Deletes the thing.",
});
const demo = defineDomain({ name: "demo", tool: "libredesk_demo", toolset: "core", summary: "Demo things.", operations: [wipe] });

afterEach(() => vi.restoreAllMocks());

describe("commandLineFor", () => {
  it("renders grouped ops with positionals first, kebab flags and quoting", () => {
    expect(commandLineFor(helpCenter, collectionCreate, { help_center_id: 1, name: "Getting started", is_published: false })).toBe(
      'ldesk help-center collection create 1 --name "Getting started" --no-is-published',
    );
  });

  it("renders positionals and plain flags", () => {
    expect(commandLineFor(articles, articleGet, { id: 42, collection_id: 3, format: "html" })).toBe(
      "ldesk articles get 42 --collection-id 3 --format html",
    );
  });

  it("escapes double quotes, single-quotes json, repeats arrays, writes null", () => {
    expect(commandLineFor(demo, wipe, { id: 1, note: 'say "hi"', tags: ["a", "b c"], meta: { k: "it's" } })).toBe(
      String.raw`ldesk demo wipe 1 --note "say \"hi\"" --tags a --tags "b c" --meta '{"k":"it'\''s"}'`,
    );
    expect(commandLineFor(demo, wipe, { id: 1, note: null })).toBe("ldesk demo wipe 1 --note null");
  });

  it("joins values starting with a dash to their flag", () => {
    expect(commandLineFor(demo, wipe, { id: 1, note: "-x y", tags: ["-a", "b"] })).toBe('ldesk demo wipe 1 --note="-x y" --tags=-a --tags b');
    expect(commandLineFor(demo, wipe, { id: -3 })).toBe("ldesk demo wipe --id=-3");
  });
});

interface Script {
  select?: string[];
  text?: string[];
  confirm?: boolean[];
}

function scripted(script: Script, log: string[] = []): PromptAdapter {
  const take = <T,>(queue: T[] | undefined, kind: string, message: string): Promise<T> => {
    log.push(`${kind}:${message}`);
    if (queue === undefined || queue.length === 0) return Promise.reject(new CancelledError());
    return Promise.resolve(queue.shift() as T);
  };
  return {
    text: (o) => take(script.text, "text", o.message),
    password: (o) => take(script.text, "password", o.message),
    confirm: (o) => take(script.confirm, "confirm", o.message),
    select: <T extends string>(o: { message: string }) => take(script.select as T[] | undefined, "select", o.message),
    note: (message, title) => void log.push(`note:${title}:${message}`),
  };
}

function setup(prompt: PromptAdapter, extra: Partial<CliDeps> = {}) {
  const runs: { name: string; values: unknown }[] = [];
  const printed: unknown[] = [];
  const d: CliDeps = {
    isTTY: true,
    prompt,
    run: (op, values) => {
      runs.push({ name: op.name, values });
      return Promise.resolve({ id: 9 });
    },
    print: (data) => void printed.push(data),
    onError: (err) => {
      throw err instanceof Error ? err : new Error(String(err));
    },
    ...extra,
  };
  return { d, runs, printed };
}

describe("runInteractive", () => {
  it("walks domain, operation, fields, runs once and shows the command", async () => {
    const log: string[] = [];
    // confirms: "Set optional fields?" yes, is_published value false, "Do something else?" no
    const prompt = scripted(
      { select: ["help-center", "collection_create", "is_published", "(done)"], text: ["1", "Getting started"], confirm: [true, false, false] },
      log,
    );
    const { d, runs, printed } = setup(prompt);
    await runInteractive(DOMAINS, d);
    expect(runs).toEqual([{ name: "collection_create", values: { help_center_id: 1, name: "Getting started", is_published: false } }]);
    expect(printed).toEqual([{ id: 9 }]);
    expect(log).toContain('note:Run it again with:ldesk help-center collection create 1 --name "Getting started" --no-is-published');
    expect(log.at(-1)).toBe("confirm:Do something else?");
  });

  it("asks for confirmation before creating a published article, and a No runs nothing", async () => {
    const log: string[] = [];
    // confirms: optional fields yes, publish confirmation No, something else no
    const prompt = scripted(
      { select: ["articles", "create", "status", "published", "(done)"], text: ["7", "T", "C"], confirm: [true, false, false] },
      log,
    );
    const { d, runs } = setup(prompt);
    await runInteractive(DOMAINS, d);
    expect(runs).toHaveLength(0);
    expect(log).toContain(`confirm:${articles.operations.find((o) => o.name === "create")?.escalate?.effect ?? ""}`);
    expect(log).toContain("note:undefined:Cancelled.");
  });

  it("does not offer hidden fields as optional fields", async () => {
    const offered: string[] = [];
    const base = scripted({ select: ["articles", "get"], text: ["42"], confirm: [true, false] });
    const prompt: PromptAdapter = {
      ...base,
      select: <T extends string>(o: { message: string; options: readonly { value: T; label: string; hint?: string }[] }) => {
        if (o.message === "Which field?") {
          offered.push(...o.options.map((option) => option.value));
          return Promise.resolve("(done)" as T);
        }
        return base.select<T>(o);
      },
    };
    const { d } = setup(prompt);
    await runInteractive(DOMAINS, d);
    expect(offered).toContain("format");
    expect(offered).not.toContain("collection_id");
  });

  it("a No at the destructive confirmation runs nothing and asks what next", async () => {
    const log: string[] = [];
    // confirms: optional fields no, destructive No, something else no
    const prompt = scripted({ select: ["demo", "wipe"], text: ["5"], confirm: [false, false, false] }, log);
    const { d, runs } = setup(prompt);
    await runInteractive([demo], d);
    expect(runs).toHaveLength(0);
    expect(log).toContain("note:undefined:Cancelled.");
    expect(log.at(-1)).toBe("confirm:Do something else?");
  });

  it("Ctrl+C at the destructive confirmation still ends the session", async () => {
    const onError = vi.fn((): never => {
      throw new Error("exited");
    });
    const base = scripted({ select: ["demo", "wipe"], text: ["5"], confirm: [false] });
    let confirms = 0;
    const prompt: PromptAdapter = { ...base, confirm: (o) => (++confirms === 2 ? Promise.reject(new CancelledError()) : base.confirm(o)) };
    const { d, runs } = setup(prompt, { onError });
    await expect(runInteractive([demo], d)).rejects.toThrow("exited");
    expect(onError).toHaveBeenCalledWith(expect.any(CancelledError));
    expect(runs).toHaveLength(0);
  });

  it("prints a run error with its hint and keeps going", async () => {
    const written: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    // confirms: optional fields no, destructive yes, something else no
    const prompt = scripted({ select: ["demo", "wipe"], text: ["5"], confirm: [false, true, false] });
    const { d } = setup(prompt, { run: () => Promise.reject(new ApiError("Boom", { status: 500, hint: "Try later." })) });
    await runInteractive([demo], d);
    expect(written.join("")).toBe("Error: Boom\nHint: Try later.\n");
  });

  it("ends through the error handler when a prompt is cancelled", async () => {
    const onError = vi.fn((): never => {
      throw new Error("exited");
    });
    const { d } = setup(scripted({}), { onError });
    await expect(runInteractive(DOMAINS, d)).rejects.toThrow("exited");
    expect(onError).toHaveBeenCalledWith(expect.any(CancelledError));
  });
});
