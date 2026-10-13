import { describe, expect, it, vi } from "vitest";
import { runCli } from "./cli-command.js";
import { createHarness } from "./cli-command.test-support.js";

describe("CLI browser suppression", () => {
  it.each([{ mode: [] }, { mode: ["--lan"] }])(
    "starts without a browser with $mode",
    async ({ mode }) => {
      const harness = createHarness();
      const controller = new AbortController();
      const run = runCli(["start", "--no-open", ...mode], {
        ...harness.options,
        signal: controller.signal,
      });
      try {
        await vi.waitFor(() => {
          expect(harness.serverListen).toHaveBeenCalledOnce();
        });
        expect(harness.dependencies.openBrowser).not.toHaveBeenCalled();
      } finally {
        controller.abort();
        await run;
      }
    },
  );
});
