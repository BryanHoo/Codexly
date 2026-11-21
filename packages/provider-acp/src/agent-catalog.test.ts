import { afterEach, expect, test, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AcpAgentCatalog } from "./agent-catalog.js";
import snapshot from "./registry-snapshot.json" with { type: "json" };
const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
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
        signal.addEventListener(
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

test("后台安装期间可以独立读取当前 Agent、阶段和检测数量", async () => {
  const { path } = await fixture();
  const installing = Promise.withResolvers<undefined>();
  const finish = Promise.withResolvers<undefined>();
  const catalog = new AcpAgentCatalog(path, {
    find: (name) => Promise.resolve(name === "codex" ? "/bin/codex" : undefined),
    install: async (_entry, _directory, _signal, report) => {
      report({ stage: "downloading", received: 25, total: 100 });
      installing.resolve(undefined);
      await finish.promise;
      return { command: "/adapter", args: [] };
    },
  });
  const discovery = catalog.list();
  try {
    await installing.promise;
    const progress = catalog.progress();
    expect(progress.discovery?.checked).toBeGreaterThan(0);
    expect(progress.discovery?.total).toBeGreaterThanOrEqual(progress.discovery?.checked ?? 0);
    expect(progress).toMatchObject({
      operations: [
        {
          engine: "codex",
          action: "automatic",
          progress: { stage: "downloading", received: 25, total: 100 },
        },
      ],
    });
  } finally {
    finish.resolve(undefined);
    await discovery;
  }
  expect(catalog.progress()).toEqual({ operations: [] });
});

function serveCodexVersion(version?: string) {
  const entry = snapshot.agents.find((agent) => agent.id === "codex-acp");
  if (!entry) throw new Error("快照缺少 Codex");
  const release = version
    ? {
        ...entry,
        version,
        distribution: { npx: { package: `@agentclientprotocol/codex-acp@${version}` } },
      }
    : entry;
  const fetch = vi.fn(() =>
    Promise.resolve(Response.json({ version: "1.0.0", agents: [release] })),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

test.each(["current", "newer"])("已安装版本为 %s 时只检查官方目录", async (version) => {
  const { catalog, install, path } = await fixture();
  const fetch = serveCodexVersion();
  await catalog.install("codex");
  if (version === "newer") await setInstalledCodexVersion(path, "9999.0.0");
  const installed = (await catalog.list(false)).agents.find((agent) => agent.engine === "codex");

  // 模拟旧页面或另一宿主仍提交更新请求，验证服务端独立阻止重复下载和降级。
  await catalog.update("codex");

  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json",
    expect.any(Object),
  );
  expect(install).toHaveBeenCalledTimes(1);
  expect(installed?.canUpdate).toBe(true);
  expect((await catalog.list(false)).agents.find((agent) => agent.engine === "codex")).toEqual(
    installed,
  );
});

async function setInstalledCodexVersion(path: string, version: string) {
  const file = join(path, "codex.json");
  const record = JSON.parse(await readFile(file, "utf8")) as { managed: { version: string } };
  record.managed.version = version;
  await writeFile(file, JSON.stringify(record));
}

test("并行更新合并检查，目录不可达时保留安装", async () => {
  const { catalog, install } = await fixture();
  await catalog.install("codex");
  const first = await catalog.command("codex");
  const checked = Promise.withResolvers<Response>();
  const entered = Promise.withResolvers<undefined>();
  const fetch = vi.fn(() => {
    entered.resolve(undefined);
    return checked.promise;
  });
  vi.stubGlobal("fetch", fetch);

  const failed = expect(
    Promise.all([catalog.update("codex"), catalog.update("codex")]),
  ).rejects.toThrow("无法检查 ACP Agent 更新");
  await entered.promise;
  expect(catalog.progress().operations).toMatchObject([
    { engine: "codex", action: "update", progress: { stage: "checking" } },
  ]);
  checked.resolve(new Response(null, { status: 503 }));
  await failed;

  expect(fetch).toHaveBeenCalledOnce();
  expect(install).toHaveBeenCalledOnce();
  expect(await catalog.command("codex")).toEqual(first);
  expect(catalog.progress().operations).toEqual([]);
});

test("更新保留启用状态和私有环境，失败时保留原运行时", async () => {
  const { path } = await fixture();
  serveCodexVersion("3.0.0");
  let version = 0;
  const catalog = new AcpAgentCatalog(path, {
    install: async (_entry, directory, _signal, report) => {
      report({ stage: "installing" });
      await mkdir(directory, { recursive: true });
      if (++version === 2) throw new Error("offline");
      const command = join(directory, "agent");
      await writeFile(command, String(version));
      return { command, args: [], env: { DEFAULT: "new" } };
    },
  });
  await catalog.install("codex");
  const installed = (await catalog.list(false)).agents.find((a) => a.engine === "codex");
  const first = await catalog.command("codex");
  await expect(catalog.update("codex")).rejects.toThrow("offline");
  expect(await catalog.command("codex")).toEqual(first);
  expect(await readFile(first.command, "utf8")).toBe("1");
  expect(
    (await catalog.list(false)).agents.find((a) => a.engine === "codex")?.installedVersion,
  ).toBe(installed?.installedVersion);
  await catalog.configure({
    ...first,
    name: "我的 Codex",
    engine: "codex",
    enabled: false,
    env: { CODEX_PATH: "/bin/codex" },
  });
  await catalog.update("codex");
  const row = (await catalog.list(false)).agents.find((a) => a.engine === "codex");
  expect(row).toMatchObject({
    enabled: false,
    name: "我的 Codex",
    installedVersion: "3.0.0",
    canUpdate: true,
  });
  expect(row?.environmentKeys).toContain("CODEX_PATH");
  if (!row?.command) throw new Error("更新后缺少运行时路径");
  expect(await readFile(row.command, "utf8")).toBe("3");
  await catalog.update("codex");
  expect(version).toBe(3);
});

test("移除清理私有运行时但不删除本机命令，重新检测不会恢复已移除的 Agent", async () => {
  const { path } = await fixture();
  const native = join(path, "native");
  await writeFile(native, "keep");
  const catalog = new AcpAgentCatalog(path, {
    find: (name) => Promise.resolve(name === "gemini" ? native : undefined),
    install: async (_entry, directory) => {
      await mkdir(directory, { recursive: true });
      const command = join(directory, "agent");
      await writeFile(command, "managed");
      return { command, args: [] };
    },
  });
  await catalog.list();
  await catalog.install("codex");
  const { command } = await catalog.command("codex");
  await catalog.remove("codex");
  await catalog.remove("acp-gemini");
  await expect(readFile(command)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(native, "utf8")).toBe("keep");
  const restarted = new AcpAgentCatalog(path, {
    find: (name) => Promise.resolve(name === "gemini" ? native : undefined),
  });
  expect((await restarted.refresh()).agents.filter((a) => a.installed)).toEqual([]);
  await expect(restarted.command("acp-gemini")).rejects.toThrow("安装并启用");
  await catalog.install("acp-gemini");
  expect((await catalog.command("acp-gemini")).command).not.toBe(native);
});
