import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createConfig, readConfig, writePrivateJson, getAutostartPaths } from "./config.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("autostart configuration", () => {
  it("freezes defaults and absolute paths without copying secrets from the environment", () => {
    const config = createConfig(
      { lan: true, workspaceRoots: ["./项目"] },
      {
        node: "/node",
        cli: "/package/dist/cli.js",
        home: "/home/user",
        cwd: "/work",
        environment: {
          PATH: "/bin",
          CODEX_HOME: "/custom",
          OPENAI_API_KEY: "secret",
          CODEXLY_PORT: "4567",
        },
      },
    );
    expect(config.start).toMatchObject({
      lan: true,
      noOpen: true,
      port: 4567,
      codexHome: resolve("/custom"),
      workspaceRoots: [resolve("/work", "项目")],
    });
    expect(config.start.lanPassword).toMatch(/^[A-Za-z0-9_-]{20,}/);
    expect(config.environment).toEqual({ PATH: "/bin" });
    expect(JSON.stringify(config)).not.toContain("secret");
  });
  it("preserves generated LAN credentials when enabling again", () => {
    const runtime = { node: "/node", cli: "/cli", home: "/home/u", cwd: "/work", environment: {} };
    const first = createConfig({ lan: true }, runtime);
    expect(createConfig({ lan: true }, runtime, first).start.lanPassword).toBe(
      first.start.lanPassword,
    );
    expect(createConfig({}, runtime, first).start.lanPassword).toBeUndefined();
    expect(() => createConfig({ lanPassword: "bad" }, runtime)).toThrow();
  });
  it("stores configuration atomically with private permissions and validates reads", async () => {
    const root = await mkdtemp(join(tmpdir(), "codexly-autostart-"));
    roots.push(root);
    const path = join(root, "private", "config.json");
    const config = createConfig(
      {},
      { node: "/node", cli: "/cli", home: root, cwd: root, environment: {} },
    );
    await writePrivateJson(path, config);
    expect(await readConfig(path)).toEqual(config);
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
    await writePrivateJson(path, { version: 999 });
    await expect(readConfig(path)).rejects.toThrow(/配置/);
    expect(await readFile(path, "utf8")).toContain("999");
  });
  it("keeps platform paths independent of CODEX_HOME", () => {
    expect(getAutostartPaths("linux", "/home/u", { XDG_CONFIG_HOME: "/settings" }).root).toBe(
      join("/settings", "codexly", "autostart"),
    );
    expect(getAutostartPaths("darwin", "/Users/u", {}).root).toContain(
      join("Library", "Application Support", "Codexly", "autostart"),
    );
    expect(() => getAutostartPaths("freebsd", "/home/u", {})).toThrow(/不支持/);
  });
});
