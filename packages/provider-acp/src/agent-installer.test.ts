import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { installRegistryAgent, type RegistryAgent } from "./agent-installer.js";
const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture(digest?: string, cmd = "./agent") {
  const directory = await mkdtemp(join(tmpdir(), "acp-installer-"));
  directories.push(directory);
  const target = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch === "arm64" ? "aarch64" : "x86_64"}`;
  const bytes = "test executable";
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(bytes))),
  );
  const agent: RegistryAgent = {
    id: "fixture",
    name: "测试",
    version: "1.0.0",
    distribution: {
      binary: {
        [target]: {
          archive: "https://example.test/agent",
          cmd,
          args: ["acp"],
          sha256: digest ?? createHash("sha256").update(bytes).digest("hex"),
        },
      },
    },
  };
  return { directory, agent };
}
it("原生安装流式校验并原子发布，不启动 Agent", async () => {
  const { directory, agent } = await fixture();
  const result = await installRegistryAgent(agent, join(directory, "runtime"));
  expect(result.args).toEqual(["acp"]);
  expect(await readFile(result.command, "utf8")).toBe("test executable");
});
it("校验失败不发布安装目录", async () => {
  const { directory, agent } = await fixture("0".repeat(64));
  await expect(installRegistryAgent(agent, join(directory, "runtime"))).rejects.toThrow("校验失败");
  await expect(stat(join(directory, "runtime"))).rejects.toMatchObject({ code: "ENOENT" });
});
it("拒绝逃逸安装目录的可执行入口", async () => {
  const { directory, agent } = await fixture(undefined, "../outside");
  await expect(installRegistryAgent(agent, join(directory, "runtime"))).rejects.toThrow(
    "超出安装目录",
  );
  await expect(stat(join(directory, "outside"))).rejects.toMatchObject({ code: "ENOENT" });
});
