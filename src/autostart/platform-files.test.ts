import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
    expect(text).toContain('WorkingDirectory="/home/$user"');
    expect(text).toContain("PartOf=graphical-session.target");
    expect(text).not.toContain("After=graphical-session.target");
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
