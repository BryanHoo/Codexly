import { describe, expect, it, vi } from "vitest";
import { runCli } from "./cli-command.js";
import { createHarness } from "./cli-command.test-support.js";

describe("runCli LAN", () => {
  it("starts explicit LAN access without opening a browser", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    const run = runCli(["start", "--", "--lan", "--port", "4567", "--session-ttl", "12h"], {
      ...harness.options,
      signal: controller.signal,
    });

    await vi.waitFor(() => {
      expect(harness.serverListen).toHaveBeenCalledOnce();
    });
    expect(harness.dependencies.createServer).toHaveBeenCalledWith(
      expect.objectContaining({
        access: { pairingCode: "fixed-test-pairing-code", sessionTtlMs: 43_200_000 },
      }),
    );
    expect(harness.serverListen).toHaveBeenCalledWith({ host: "0.0.0.0", port: 4567 });
    expect(harness.dependencies.openBrowser).not.toHaveBeenCalled();
    expect(harness.dependencies.listLanAccessUrls).toHaveBeenCalledWith(4567);
    expect(harness.stdout.join("\n")).toContain("http://192.168.1.20:4567");
    expect(harness.stdout.join("\n")).toContain("fixed-test-pairing-code");
    expect(harness.stdout.join("\n")).not.toContain("http://0.0.0.0:4567");

    controller.abort();
    await expect(run).resolves.toBe(0);
  });

  it("keeps LAN sessions unexpired by default", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    const run = runCli(["start", "--lan"], {
      ...harness.options,
      signal: controller.signal,
    });

    await vi.waitFor(() => {
      expect(harness.serverListen).toHaveBeenCalledOnce();
    });
    expect(harness.dependencies.createServer).toHaveBeenCalledWith(
      expect.objectContaining({ access: { pairingCode: "fixed-test-pairing-code" } }),
    );
    expect(harness.stdout.join("\n")).toContain("会话有效期: 永不过期");

    controller.abort();
    await expect(run).resolves.toBe(0);
  });

  it("passes repeatable exact reverse proxy domains without enabling LAN", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    const run = runCli(
      ["start", "--allowed-host", "Code.Example.com", "--allowed-host", "admin.example.com"],
      { ...harness.options, signal: controller.signal },
    );

    await vi.waitFor(() => {
      expect(harness.serverListen).toHaveBeenCalledOnce();
    });
    expect(harness.dependencies.createServer).toHaveBeenCalledWith(
      expect.objectContaining({ allowedHosts: ["code.example.com", "admin.example.com"] }),
    );
    expect(harness.serverListen).toHaveBeenCalledWith({ host: "127.0.0.1", port: 3210 });

    controller.abort();
    await expect(run).resolves.toBe(0);
  });

  it("uses a strong custom LAN password without generating or printing a credential", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    const password = "Strong-Lan_Pass9!";
    const run = runCli(["start", "--lan", "--lan-password", password, "--session-ttl", "180d"], {
      ...harness.options,
      signal: controller.signal,
    });

    await vi.waitFor(() => {
      expect(harness.serverListen).toHaveBeenCalledOnce();
    });
    expect(harness.dependencies.createServer).toHaveBeenCalledWith(
      expect.objectContaining({
        access: { pairingCode: password, sessionTtlMs: 15_552_000_000 },
      }),
    );
    expect(harness.dependencies.generateLanPairingCode).not.toHaveBeenCalled();
    expect(harness.stdout.join("\n")).toContain("已使用自定义访问密码");
    expect(harness.stdout.join("\n")).not.toContain(password);

    controller.abort();
    await expect(run).resolves.toBe(0);
  });

  it("rejects invalid LAN options before starting runtime resources", async () => {
    for (const args of [
      ["start", "--session-ttl", "12h"],
      ["start", "--lan-password", "Strong-Lan_Pass9!"],
      ["start", "--lan", "--lan-password", "weak-password"],
      ["start", "--allowed-host", "*.example.com"],
      ["start", "--allowed-host", "https://code.example.com"],
      ["start", "--allowed-host", "code.example.com:443"],
      ["start", "--lan", "--lan"],
      ["start", "--lan", "--codex-bin", "/first", "--codex-bin", "/second"],
    ]) {
      const harness = createHarness();
      await expect(runCli(args, harness.options)).resolves.toBe(1);
      expect(harness.dependencies.createStateRepository).not.toHaveBeenCalled();
      expect(harness.dependencies.startCodexAppServer).not.toHaveBeenCalled();
    }
  });

  it("rejects invalid ports before starting runtime resources", async () => {
    for (const port of ["0", "65536", "1.5", "invalid"]) {
      const harness = createHarness();

      await expect(runCli(["start", "--port", port], harness.options)).resolves.toBe(1);
      expect(harness.dependencies.createStateRepository).not.toHaveBeenCalled();
      expect(harness.dependencies.startCodexAppServer).not.toHaveBeenCalled();
      expect(harness.stderr.join("")).toContain("--port");
    }
  });

  it("keeps the server running when opening the browser fails", async () => {
    const harness = createHarness({
      openBrowser: vi.fn(() => Promise.reject(new Error("browser unavailable"))),
    });
    const controller = new AbortController();
    const run = runCli(["start"], {
      ...harness.options,
      signal: controller.signal,
    });

    await vi.waitFor(() => {
      expect(harness.serverListen).toHaveBeenCalledOnce();
    });
    controller.abort();

    await expect(run).resolves.toBe(0);
    expect(harness.stderr.join("")).toContain("browser unavailable");
    expect(harness.stderr.join("")).toContain("[警告] 无法自动打开浏览器");
  });
});
