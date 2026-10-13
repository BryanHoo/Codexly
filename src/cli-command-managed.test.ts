import { describe, expect, it, vi } from "vitest";
import { runCli, runStart } from "./cli-command.js";
import { createHarness } from "./cli-command.test-support.js";
import { createTerminalOutput } from "./terminal-output.js";

describe("CLI managed startup", () => {
  it.each([false, true])(
    "skips update network access, forces browser suppression and reports readiness (LAN=%s)",
    async (lan) => {
      const f = createHarness();
      const controller = new AbortController();
      const messages: string[] = [];
      const onReady = vi.fn(() => Promise.resolve());
      const run = runStart(
        [],
        f.dependencies,
        controller.signal,
        createTerminalOutput(
          (message) => messages.push(message),
          (message) => messages.push(message),
          false,
        ),
        {
          options: {
            lan,
            noOpen: true,
            codexHome: "/persisted/home",
            port: 4321,
            ...(lan ? { lanPassword: "Saved-Lan_Password123" } : {}),
          },
          background: true,
          environment: { PATH: "/frozen/bin" },
          onReady,
        },
      );
      try {
        await vi.waitFor(() => {
          expect(onReady).toHaveBeenCalledWith({ host: lan ? "0.0.0.0" : "127.0.0.1", port: 4321 });
        });
        const [serverOptions] = vi.mocked(f.dependencies.createServer).mock.calls[0] ?? [];
        expect(serverOptions?.logDestination).toBeDefined();
        serverOptions?.logDestination?.write("runtime diagnostic");
        expect(messages).toContain("runtime diagnostic");
        expect(f.dependencies.checkAppUpdate).not.toHaveBeenCalled();
        expect(f.dependencies.confirmAppUpdate).not.toHaveBeenCalled();
        expect(f.dependencies.openBrowser).not.toHaveBeenCalled();
        expect(f.dependencies.startCodexAppServer).toHaveBeenCalledWith(
          expect.objectContaining({ env: { PATH: "/frozen/bin", CODEX_HOME: "/persisted/home" } }),
        );
      } finally {
        controller.abort();
        await run;
      }
      expect(f.databaseClose).toHaveBeenCalledOnce();
      expect(f.serverClose).toHaveBeenCalledOnce();
    },
  );
  it("supports autostart help without starting a server", async () => {
    const f = createHarness();
    await expect(runCli(["autostart", "--help"], f.options)).resolves.toBe(0);
    expect(f.stdout.join("")).toContain("credentials");
    expect(f.dependencies.startCodexAppServer).not.toHaveBeenCalled();
  });
});
