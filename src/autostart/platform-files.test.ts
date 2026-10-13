import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConfig, getAutostartPaths } from "./config.js";
import { createPlatformAdapter } from "./platform.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(platform: "darwin" | "linux") {
  const root = await mkdtemp(join(tmpdir(), "codexly-platform-"));
  roots.push(root);
  const paths = getAutostartPaths(platform, root, {});
  const config = createConfig(
    {},
    {
      node: process.execPath,
      cli: join(root, '中文 & "$% folder', "dist", "cli.js"),
      home: root,
      cwd: root,
      environment: {},
    },
  );
  const execute = vi.fn((_command: string, args: readonly string[]) =>
    Promise.resolve({ code: 0, stdout: args.includes("show-user") ? "no" : "", stderr: "" }),
  );
  return {
    paths,
    config,
    execute,
    adapter: createPlatformAdapter(platform, paths, { execute, uid: 501 }),
  };
}
describe("native registration files", () => {
  it("writes Windows task XML in BOM-prefixed UTF-16 for Task Scheduler", async () => {
    const root = await mkdtemp(join(tmpdir(), "codexly-windows-task-"));
    roots.push(root);
    const paths = getAutostartPaths("win32", root, { LOCALAPPDATA: root });
    const config = createConfig(
      {},
      {
        node: process.execPath,
        cli: join(root, "中文 folder", "dist", "cli.js"),
        home: root,
        cwd: root,
        environment: {},
      },
    );
    const execute = vi.fn(() => Promise.resolve({ code: 0, stdout: "S-1-5-21-123", stderr: "" }));
    await createPlatformAdapter("win32", paths, { execute }).install(config);
    const bytes = await readFile(paths.registration);
    expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xfe]);
    const xml = bytes.subarray(2).toString("utf16le");
    expect(xml).toContain('encoding="UTF-16"');
    expect(xml).toContain("中文 folder");
    expect(execute.mock.calls).toHaveLength(2);
  });
  it("registers and unregisters Linux login startup without starting it", async () => {
    const f = await fixture("linux");
    await f.adapter.install(await f.adapter.prepare(f.config));
    expect(await readFile(f.paths.registration, "utf8")).toContain("WantedBy=default.target");
    expect(
      f.execute.mock.calls.some(([, args]) => args.includes("restart") || args.includes("--now")),
    ).toBe(false);
    await f.adapter.remove();
    await expect(readFile(f.paths.registration)).rejects.toMatchObject({ code: "ENOENT" });
    expect(f.execute.mock.calls.some(([, args]) => args.includes("stop"))).toBe(true);
  });
  it("does not create a systemd ordering cycle for graphical login", async () => {
    const f = await fixture("linux");
    await f.adapter.install({
      ...f.config,
      home: "/home/$user",
      linuxTarget: "graphical-session.target",
    });
    const text = await readFile(f.paths.registration, "utf8");
    expect(text).toContain("WorkingDirectory=/home/$user");
    expect(text).toContain("PartOf=graphical-session.target");
    expect(text).not.toContain("After=graphical-session.target");
  });
  it.skipIf(process.platform !== "linux")(
    "validates Linux login startup with the native systemd parser",
    async () => {
      const f = await fixture("linux");
      const home = join(f.config.home, 'home space $%"\\ path');
      await mkdir(home);
      await f.adapter.install({ ...f.config, home });
      await expect(
        promisify(execFile)("systemd-analyze", ["--user", "verify", f.paths.registration]),
      ).resolves.toMatchObject({ stderr: "" });
    },
  );
  it("removes an inactive Linux registration even when its unit could not load", async () => {
    const f = await fixture("linux");
    await f.adapter.install(f.config);
    f.execute.mockImplementation((_command: string, args: readonly string[]) =>
      Promise.resolve({
        code: args.includes("stop") ? 1 : 0,
        stdout: args.includes("show") ? "inactive\n" : "",
        stderr: args.includes("stop") ? "Unit codexly-web.service not loaded." : "",
      }),
    );
    await f.adapter.remove();
    await expect(readFile(f.paths.registration)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("enables macOS login startup without bootstrapping a running instance", async () => {
    const f = await fixture("darwin");
    await f.adapter.install(f.config);
    expect(f.execute.mock.calls.some(([, args]) => args.includes("bootstrap"))).toBe(false);
    expect((await f.adapter.status()).enabled).toBe(true);
    f.execute.mockResolvedValueOnce({ code: 0, stdout: '"io.codexly.web" => true', stderr: "" });
    expect((await f.adapter.status()).enabled).toBe(false);
  });
  it.skipIf(process.platform !== "darwin")(
    "validates generated LaunchAgent with the native plist parser",
    async () => {
      const f = await fixture("darwin");
      await f.adapter.install(f.config);
      const result = await promisify(execFile)("plutil", ["-lint", "--", f.paths.registration]);
      expect(result.stdout).toContain("OK");
    },
  );
});
