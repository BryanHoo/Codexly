import { homedir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "./cli-command.js";
import { createHarness } from "./cli-command.test-support.js";

describe("CLI multiple Web instances", () => {
  it("starts two instances with shared application storage with independent shutdown", async () => {
    vi.spyOn(process, "cwd").mockReturnValue("/unrelated/launch-directory");
    const first = createHarness();
    const second = createHarness();
    const firstController = new AbortController();
    const secondController = new AbortController();
    const runs = [
      runCli(["start"], {
        ...first.options,
        signal: firstController.signal,
      }),
      runCli(["start"], {
        ...second.options,
        signal: secondController.signal,
      }),
    ];
    try {
      await vi.waitFor(() => {
        expect(first.serverListen).toHaveBeenCalledOnce();
        expect(second.serverListen).toHaveBeenCalledOnce();
      });
      for (const harness of [first, second]) {
        expect(harness.dependencies.createServer).toHaveBeenCalledWith(
          expect.objectContaining({ standaloneCwd: homedir() }),
        );
      }
      firstController.abort();
      await expect(runs[0]).resolves.toBe(0);
      expect(first.serverClose).toHaveBeenCalledOnce();
      expect(second.serverClose).not.toHaveBeenCalled();
    } finally {
      firstController.abort();
      secondController.abort();
      await Promise.all(runs);
    }
    expect(second.serverClose).toHaveBeenCalledOnce();
  });
});
