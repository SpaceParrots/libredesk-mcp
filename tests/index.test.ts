import { describe, expect, it, vi } from "vitest";
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
});
