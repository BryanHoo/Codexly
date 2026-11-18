import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AcpAgentCatalog } from "./agent-catalog.js";
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture(found: string[] = []) {
  const path = await mkdtemp(join(tmpdir(), "acp-catalog-"));
  directories.push(path);
  const install = vi.fn(() =>
    Promise.resolve({ command: "/runtime/node", args: ["/agent/index.js"] }),
  );
  const catalog = new AcpAgentCatalog(path, {
    find: (name) => Promise.resolve(found.includes(name) ? `/bin/${name}` : undefined),
    install,
  });
  return { catalog, install, path };
}
test("空电脑不会安装 Codex 或 Claude", async () => {
  const { catalog, install } = await fixture();
  expect((await catalog.list()).agents.filter((a) => a.installed)).toEqual([]);
  expect(install).not.toHaveBeenCalled();
});
test("只为检测到的 CLI 自动安装适配器，原生 ACP 直接复用", async () => {
  const { catalog, install } = await fixture(["codex", "gemini"]);
  const page = await catalog.list();
  expect(page.agents.find((a) => a.engine === "codex")?.installed).toBe(true);
  expect(page.agents.find((a) => a.engine === "acp-gemini")?.installed).toBe(true);
  expect(page.agents.find((a) => a.engine === "claude")?.installed).toBe(false);
  expect(install).toHaveBeenCalledTimes(1);
});
test("手动安装合并并发请求，重建后读取配置", async () => {
  const { catalog, install, path } = await fixture();
  await Promise.all([catalog.install("acp-gemini"), catalog.install("acp-gemini")]);
  expect(install).toHaveBeenCalledTimes(1);
  const next = new AcpAgentCatalog(path, { find: () => Promise.resolve(undefined), install });
  expect((await next.command("acp-gemini")).command).toBe("/runtime/node");
});
test("安装失败保持未安装并允许重试", async () => {
  const { catalog, install } = await fixture();
  install.mockRejectedValueOnce(new Error("offline"));
  await expect(catalog.install("claude")).rejects.toThrow("offline");
  expect((await catalog.list()).agents.find((a) => a.engine === "claude")?.installed).toBe(false);
  await catalog.install("claude");
});
test("支持自定义 Agent 参数与私有环境，公开列表不泄露凭据", async () => {
  const { catalog } = await fixture();
  await catalog.configure({
    engine: "acp-my-agent",
    name: "My Agent",
    command: "/path with spaces/agent",
    args: ["--acp"],
    env: { API_KEY: "secret" },
    enabled: true,
  });
  expect((await catalog.command("acp-my-agent")).env).toEqual({ API_KEY: "secret" });
  expect(JSON.stringify(await catalog.list())).not.toContain("secret");
  await expect(catalog.command("acp-unknown")).rejects.toThrow();
});
test("刷新只发现新增 CLI，保持用户停用与私有配置", async () => {
  const found: string[] = [];
  const { catalog } = await fixture(found);
  await catalog.list();
  found.push("gemini");
  expect((await catalog.refresh()).agents.find((a) => a.engine === "acp-gemini")?.enabled).toBe(
    true,
  );
  await catalog.configure({
    engine: "acp-gemini",
    name: "我的 Gemini",
    command: "/custom/gemini",
    args: ["--acp"],
    env: { KEY: "private" },
    enabled: false,
  });
  const page = await catalog.refresh();
  expect(page.agents.find((a) => a.engine === "acp-gemini")).toMatchObject({
    enabled: false,
    name: "我的 Gemini",
    command: "/custom/gemini",
  });
  expect(JSON.stringify(page)).not.toContain("private");
});
test("关闭目录取消正在安装的任务，不发布迟到安装记录", async () => {
  const { path } = await fixture();
  const started = Promise.withResolvers<undefined>();
  const catalog = new AcpAgentCatalog(path, {
    find: () => Promise.resolve(undefined),
    install: (_entry, _directory, signal) =>
      new Promise((_resolve, reject) => {
        started.resolve(undefined);
        signal?.addEventListener(
          "abort",
          () => {
            reject(new Error("安装已取消"));
          },
          { once: true },
        );
      }),
  });
  const install = catalog.install("codex");
  const rejected = expect(install).rejects.toThrow("安装已取消");
  await started.promise;
  await catalog.close();
  await rejected;
  expect((await catalog.list(false)).agents.find((a) => a.engine === "codex")?.installed).toBe(
    false,
  );
});
