import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConfig, getAutostartPaths } from "./config.js";
import { queryRuntime, runManaged, stopManaged } from "./runtime.js";
import { createLog, readLogTail } from "./log.js";
import { waitForAbort } from "../cli-shutdown.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codexly-service-"));
  roots.push(root);
  const paths = getAutostartPaths("linux", root, {});
  const config = createConfig(
    { lan: true },
    { node: process.execPath, cli: "/cli", home: root, cwd: root, environment: {} },
  );
  return { paths, config };
}
describe("managed Web runtime", () => {
  it("publishes actual readiness and supports authenticated graceful shutdown", async () => {
    const { config, paths } = await fixture();
    const run = runManaged(config, paths, async (context) => {
      expect(context.options.noOpen).toBe(true);
      expect(context.background).toBe(true);
      await context.onReady({ host: "0.0.0.0", port: 3211 });
      await waitForAbort(context.signal);
      return 0;
    });
    try {
      await vi.waitFor(async () => {
        expect(await queryRuntime(paths)).toMatchObject({ phase: "ready", port: 3211, lan: true });
      });
      const state: unknown = JSON.parse(await readFile(paths.state, "utf8"));
      expect(await queryRuntime(paths, "wrong-token")).toBeUndefined();
      expect(JSON.stringify(state)).not.toContain(config.start.lanPassword);
    } finally {
      await stopManaged(paths);
      await run;
    }
    expect(await queryRuntime(paths)).toBeUndefined();
  });
  it("records startup failure without leaking LAN secrets", async () => {
    const { config, paths } = await fixture();
    await expect(
      runManaged(config, paths, () =>
        Promise.reject(new Error(`failed ${String(config.start.lanPassword)}`)),
      ),
    ).resolves.toBe(1);
    expect(await readFile(paths.state, "utf8")).toContain("failed");
    expect(await readFile(paths.state, "utf8")).not.toContain(config.start.lanPassword);
    expect(await readLogTail(paths.log)).toContain("[REDACTED]");
  });
  it("bounds and rotates logs while redacting credentials", async () => {
    const { paths } = await fixture();
    const log = await createLog(paths.log, "Secret-Lan_123456", 1024);
    log.write("Secret-Lan_123456");
    await log.flush();
    expect(await readLogTail(paths.log)).not.toContain("Secret-Lan_123456");
    for (let i = 0; i < 30; i++) {
      log.write("x".repeat(100));
      await log.flush();
    }
    expect(Buffer.byteLength(await readLogTail(paths.log))).toBeLessThanOrEqual(1024);
    expect(Buffer.byteLength(await readFile(`${paths.log}.1`, "utf8"))).toBeLessThanOrEqual(1024);
  });
});
