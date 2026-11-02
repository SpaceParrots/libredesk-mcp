import { describe, expect, it, vi } from "vitest";
import { ConfigError } from "../src/errors.js";
import { main } from "../src/index.js";

describe("main", () => {
  it("with no args and no TTY starts serve", async () => {
    const startServer = vi.fn().mockResolvedValue(undefined);
    const runInteractive = vi.fn().mockResolvedValue(undefined);
    await main(["node", "ldesk"], { isTTY: false, startServer, runInteractive });
    expect(startServer).toHaveBeenCalledTimes(1);
    expect(runInteractive).not.toHaveBeenCalled();
  });

  it("with no args and a TTY starts interactive mode", async () => {
    const startServer = vi.fn().mockResolvedValue(undefined);
    const runInteractive = vi.fn().mockResolvedValue(undefined);
    await main(["node", "ldesk"], { isTTY: true, startServer, runInteractive });
    expect(runInteractive).toHaveBeenCalledTimes(1);
    expect(startServer).not.toHaveBeenCalled();
  });

  it("routes a startup error of the no-args path through the error handler with its hint", async () => {
    const error = new ConfigError("LIBREDESK_TOOLSETS names an unknown toolset.", { hint: "Use core or all." });
    const onError = vi.fn<(err: unknown) => never>(() => {
      throw new Error("handled");
    });
    const startServer = vi.fn().mockRejectedValue(error);
    await expect(main(["node", "ldesk"], { isTTY: false, startServer, onError })).rejects.toThrow("handled");
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("the default handler prints the hint to stderr and nothing to stdout", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    const startServer = vi.fn().mockRejectedValue(new ConfigError("bad toolsets", { hint: "Use core or all." }));
    try {
      await expect(main(["node", "ldesk"], { isTTY: false, startServer })).rejects.toThrow("exit");
      expect(stderr.mock.calls.join("")).toContain("Hint: Use core or all.");
      expect(stdout).not.toHaveBeenCalled();
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
