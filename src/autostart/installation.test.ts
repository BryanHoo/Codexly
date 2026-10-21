import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateGlobalInstallation } from "./command.js";
import { execute } from "./platform.js";
import type * as PlatformModule from "./platform.js";

vi.mock("./platform.js", async (importOriginal) => ({
  ...(await importOriginal<typeof PlatformModule>()),
  execute: vi.fn(),
}));

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codexly-installation-"));
  roots.push(root);
  const node = join(root, "bin", process.platform === "win32" ? "node.exe" : "node");
  const globalRoot = join(root, "lib", "node_modules");
  const packageRoot = join(globalRoot, "@bryanhu", "codexly");
  const cli = join(packageRoot, "dist", "cli.js");
  const npmCli =
    process.platform === "win32"
      ? join(dirname(node), "node_modules", "npm", "bin", "npm-cli.js")
      : join(globalRoot, "npm", "bin", "npm-cli.js");
  await mkdir(dirname(node), { recursive: true });
  await mkdir(dirname(cli), { recursive: true });
  await mkdir(dirname(npmCli), { recursive: true });
  await writeFile(node, "");
  await writeFile(cli, "");
  await writeFile(npmCli, "");
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "@bryanhu/codexly" }));
  // 模拟 PATH 中的 npm 属于另一套 Node；只有运行时自带的 npm 返回正确全局目录。
  vi.mocked(execute).mockImplementation((command) =>
    Promise.resolve({
      code: 0,
      stdout: `${command === node ? globalRoot : join(root, "other-node", "node_modules")}\n`,
      stderr: "",
    }),
  );
  return {
    root,
    npmCli,
    packageRoot,
    runtime: { node, cli, home: root, cwd: root, environment: {} },
  };
}

describe("autostart global installation validation", () => {
  it("accepts the running Node's global package when PATH points to another npm", async () => {
    const f = await fixture();
    await expect(validateGlobalInstallation(f.runtime)).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledWith(f.runtime.node, [f.npmCli, "root", "--global"]);
    expect(f.runtime.cli).toBe(await realpath(join(f.packageRoot, "dist", "cli.js")));
  });

  it("still rejects a project-local CLI when a global installation exists", async () => {
    const f = await fixture();
    const localCli = join(
      f.root,
      "project",
      "node_modules",
      "@bryanhu",
      "codexly",
      "dist",
      "cli.js",
    );
    await mkdir(dirname(localCli), { recursive: true });
    await writeFile(localCli, "");
    f.runtime.cli = localCli;
    await expect(validateGlobalInstallation(f.runtime)).rejects.toThrow("使用全局 codexly");
  });

  it("rejects temporary npx installations before invoking npm", async () => {
    const f = await fixture();
    f.runtime.cli = join(f.root, "_npx", "cache", "dist", "cli.js");
    vi.mocked(execute).mockClear();
    await expect(validateGlobalInstallation(f.runtime)).rejects.toThrow("使用全局 codexly");
    expect(execute).not.toHaveBeenCalled();
  });

  it("reports a failed npm global directory lookup", async () => {
    const f = await fixture();
    vi.mocked(execute).mockResolvedValue({ code: 1, stdout: "", stderr: "npm failed" });
    await expect(validateGlobalInstallation(f.runtime)).rejects.toThrow("无法读取 npm 全局目录");
  });

  it("rejects a package with an unexpected manifest", async () => {
    const f = await fixture();
    await writeFile(
      join(f.packageRoot, "package.json"),
      JSON.stringify({ name: "another-package" }),
    );
    await expect(validateGlobalInstallation(f.runtime)).rejects.toThrow("使用全局 codexly");
  });
});
