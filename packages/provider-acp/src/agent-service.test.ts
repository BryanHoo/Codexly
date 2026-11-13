import { withStorageCatalog } from "./storage-catalog.test-support.js";
import * as acp from "@agentclientprotocol/sdk/unstable";
import { expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AcpConnection } from "./connection.js";
import { AcpAgentService } from "./agent-service.js";
import { AcpSettingsStore } from "./settings-store.js";
import type { AcpAgentLauncher } from "./runtime.js";
import { AcpRuntime } from "./runtime.js";
import type { EngineProjectRouter } from "@codexly/core";

const initial: acp.SessionConfigOption[] = [
  {
    id: "model",
    name: "模型",
    category: "model",
    type: "select",
    currentValue: "a",
    options: [
      { value: "a", name: "A" },
      { value: "b", name: "B" },
    ],
  },
  {
    id: "effort",
    name: "思考",
    category: "thought_level",
    type: "select",
    currentValue: "low",
    options: [{ value: "low", name: "低" }],
  },
];
async function fixture(nativeStatus?: () => Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), "acp-settings-"));
  const authenticate = vi.fn<
    (
      context: acp.AgentRequestContext<acp.AuthenticateRequest>,
    ) => acp.AuthenticateResponse | Promise<acp.AuthenticateResponse>
  >(({ params }) => {
    if (params.methodId === "fail") throw acp.RequestError.authRequired();
    return {};
  });
  const closed = vi.fn(() => ({}));
  const applied = vi.fn();
  const transformOptions = vi.fn((_id: string, options: acp.SessionConfigOption[]) => options);
  const routingSet = vi.fn(() => ({}));
  let sequence = 0;
  const launch = vi.fn<AcpAgentLauncher>(async (_engine, _scope, callbacks) => {
    const a = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
    const b = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
    const sessions = new Map<string, acp.SessionConfigOption[]>();
    const peer = acp
      .agent({ name: "test" })
      .onRequest(acp.methods.agent.initialize, async ({ client }) => {
        const authStatus = nativeStatus?.();
        if (authStatus) await client.notify("_auth/status_update", { authStatus });
        return {
          protocolVersion: 1,
          authMethods: [
            { id: "login", name: "登录" },
            { id: "fail", name: "失败" },
            { id: "terminal", name: "终端", type: "terminal" as const },
          ],
          agentCapabilities: {
            sessionCapabilities: { close: {} },
            providers: {},
            ...(nativeStatus ? { _meta: { authStatus: {} } } : {}),
          },
        };
      })
      .onRequest(acp.methods.agent.authenticate, authenticate)
      .onRequest(acp.methods.agent.providers.list, () => ({
        providers: [{ providerId: "main", supported: ["openai"], required: false, current: null }],
      }))
      .onRequest(acp.methods.agent.providers.set, routingSet)
      .onRequest(acp.methods.agent.session.new, () => {
        const sessionId = `settings-${String(++sequence)}`;
        sessions.set(sessionId, structuredClone(initial));
        return { sessionId, configOptions: structuredClone(initial) };
      })
      .onRequest(acp.methods.agent.session.close, closed)
      .onRequest(acp.methods.agent.session.setConfigOption, ({ params }) => {
        applied(params.configId, params.value);
        const options = sessions.get(params.sessionId);
        const option = options?.find((value) => value.id === params.configId);
        if (!options || !option) throw new Error("缺少测试会话配置");
        if (option.type === "select" && typeof params.value === "string")
          option.currentValue = params.value;
        if (option.type === "boolean" && typeof params.value === "boolean")
          option.currentValue = params.value;
        if (params.configId === "model") {
          const effort = options[1];
          if (effort?.type === "select")
            effort.options = [
              { value: "low", name: "低" },
              { value: "high", name: "高" },
            ];
        }
        const configOptions = transformOptions(params.configId, options);
        sessions.set(params.sessionId, configOptions);
        return { configOptions };
      })
      .connect({ readable: a.readable, writable: b.writable });
    const connection = await AcpConnection.connect(
      { readable: b.readable, writable: a.writable },
      callbacks,
    );
    return {
      connection,
      close: () => {
        connection.close();
        peer.close();
        return Promise.resolve();
      },
    };
  });
  const store = new AcpSettingsStore(root);
  const service = new AcpAgentService("claude", root, store, launch);
  return {
    root,
    service,
    store,
    authenticate,
    applied,
    transformOptions,
    routingSet,
    closed,
    launch,
    async dispose() {
      await service.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

it("ACP 配置写入及迁移保留旧配置原文，旧版后续修改也不被第二次导入覆盖", async () => {
  const f = await fixture();
  const directory = join(f.root, "engines", "acp", "settings");
  const store = new AcpSettingsStore(directory);
  const service = new AcpAgentService("claude", directory, store, f.launch);
  const files = [
    "agent-settings.json",
    ".codex/config.toml",
    ".claude/settings.json",
    "engines/claude/settings.json",
  ];
  const before = files.map((path, index) =>
    path.endsWith("toml")
      ? '# preserve comments\nmodel = "legacy-model"\n'
      : JSON.stringify({ model: "a", reasoningEffort: "low", legacyExtra: index }) + "\n",
  );
  try {
    for (const [index, path] of files.entries()) {
      const target = join(f.root, path);
      await mkdir(join(target, ".."), { recursive: true });
      const content = before[index];
      if (content === undefined) throw new Error("缺少旧配置夹具");
      await writeFile(target, content);
    }
    await store.importLegacy("claude", { model: "a", reasoningEffort: "low" });
    f.transformOptions.mockImplementation((_id, options) => [
      ...options,
      ...(options.some((option) => option.id === "future-mode")
        ? []
        : [
            {
              id: "future-mode",
              name: "新布尔配置",
              type: "boolean" as const,
              currentValue: false,
            },
          ]),
    ]);
    await service.setDefaultConfig("model", "b");
    await service.setDefaultConfig("future-mode", true);
    expect((await store.read("claude")).values["future-mode"]).toBe(true);
    for (const [index, path] of files.entries())
      expect(await readFile(join(f.root, path), "utf8")).toBe(before[index]);
    await writeFile(join(f.root, "agent-settings.json"), '{"model":"old-version-updated"}\n');
    await store.importLegacy("claude", { model: "old-version-updated" });
    expect((await store.read("claude")).values["model"]).toBe("b");
    expect(await readFile(join(f.root, "agent-settings.json"), "utf8")).toBe(
      '{"model":"old-version-updated"}\n',
    );
  } finally {
    await service.close();
    await f.dispose();
  }
});

it("认证仅调用公布的 agent 方法，终端认证与失败不得伪装成功", async () => {
  const f = await fixture();
  try {
    expect(f.launch).not.toHaveBeenCalled();
    expect(await f.service.inspect()).toMatchObject({
      engine: "claude",
      protocolVersion: 1,
      providerConfiguration: true,
      authMethods: [{ id: "login" }, { id: "fail" }, { id: "terminal", type: "terminal" }],
    });
    await expect(f.service.authenticate("missing")).rejects.toThrow("认证方式");
    await expect(f.service.authenticate("terminal")).rejects.toThrow("终端");
    expect(f.authenticate).not.toHaveBeenCalled();
    await expect(f.service.authenticate("fail")).rejects.toThrow();
    await expect(f.service.authenticate("login")).resolves.toEqual({});
    expect(f.authenticate.mock.calls.at(-1)?.[0].params).toEqual({ methodId: "login" });
  } finally {
    await f.dispose();
  }
});

it("单项模型切换消费完整响应，失效依赖保留原值，不重送旧思考档位", async () => {
  const f = await fixture();
  try {
    await f.service.updateDefaults({ model: "b", effort: "high" });
    f.transformOptions.mockImplementation((id, options) =>
      id === "model" && options[0]?.currentValue === "a"
        ? options.filter((option) => option.id !== "effort")
        : options,
    );
    const result = await f.service.setDefaultConfig("model", "a");
    expect(result.defaults).toEqual({ model: "a" });
    expect(result.configOptions.map((option) => option.id)).toEqual(["model"]);
    expect(result.unmappedLegacy).toContain("effort");
    expect(await f.store.read("claude")).toMatchObject({
      values: { model: "a" },
      retainedValues: { effort: "high" },
    });
    expect(JSON.stringify(result)).not.toContain('"effort":"high"');
    expect((await f.service.readDefaults()).unmappedLegacy).toContain("effort");
  } finally {
    await f.dispose();
  }
});

it("单项布尔变更保留 false，未知选项与关闭失败不覆盖原设置", async () => {
  const f = await fixture();
  try {
    f.transformOptions.mockImplementation((_id, options) => [
      ...options,
      { id: "enabled", name: "开关", type: "boolean", currentValue: false },
    ]);
    await f.service.updateDefaults({ model: "b" });
    expect((await f.service.setDefaultConfig("enabled", false)).defaults).toEqual({
      model: "b",
      enabled: false,
    });
    const before = await f.store.read("claude");
    await expect(f.service.setDefaultConfig("unknown", true)).rejects.toThrow("配置");
    expect(await f.store.read("claude")).toEqual(before);
    f.closed.mockImplementationOnce(() => {
      throw new Error("关闭失败");
    });
    await expect(f.service.setDefaultConfig("model", "a")).rejects.toThrow();
    expect(await f.store.read("claude")).toEqual(before);
  } finally {
    await f.dispose();
  }
});

it("单项保存遇到另一宿主更新时拒绝覆盖并保留新配置", async () => {
  const f = await fixture();
  try {
    await f.service.updateDefaults({ model: "b" });
    const update = f.store.update.bind(f.store);
    const spy = vi.spyOn(f.store, "update").mockImplementationOnce(async (engine, change) => {
      await update(engine, (current) => ({ ...current, values: { model: "a", effort: "low" } }));
      return update(engine, change);
    });
    await expect(f.service.setDefaultConfig("effort", "high")).rejects.toThrow("已变化");
    spy.mockRestore();
    expect((await f.store.read("claude")).values).toEqual({ model: "a", effort: "low" });
  } finally {
    await f.dispose();
  }
});

it("ACP 原始配置 ID 使用记录键语义，保留特殊键的布尔值", async () => {
  const f = await fixture();
  try {
    f.transformOptions.mockImplementation((_id, options) => [
      ...options,
      { id: "__proto__", name: "扩展开关", type: "boolean", currentValue: false },
    ]);
    await f.service.updateDefaults({ model: "b" });
    const result = await f.service.setDefaultConfig("__proto__", false);
    expect(Object.hasOwn(result.defaults, "__proto__")).toBe(true);
    expect(result.defaults["__proto__"]).toBe(false);
    expect(Object.hasOwn((await f.store.read("claude")).values, "__proto__")).toBe(true);
  } finally {
    await f.dispose();
  }
});

it("默认值按 agent 更新后的完整选项校验并持久化，失败不覆盖保存值", async () => {
  const f = await fixture();
  try {
    const result = await f.service.updateDefaults({ effort: "high", model: "b" });
    expect(result.defaults).toEqual({ model: "b", effort: "high" });
    expect(f.applied.mock.calls).toEqual([
      ["model", "b"],
      ["effort", "high"],
    ]);
    expect(f.closed).toHaveBeenCalledOnce();
    await expect(f.service.updateDefaults({ model: "missing" })).rejects.toThrow("配置");
    expect((await f.service.readDefaults()).defaults).toEqual({ model: "b", effort: "high" });
    expect((await new AcpSettingsStore(f.root).read("claude")).values).toEqual({
      model: "b",
      effort: "high",
    });
    if (process.platform !== "win32")
      expect((await stat(join(f.root, "claude.json"))).mode & 0o777).toBe(0o600);
  } finally {
    await f.dispose();
  }
});

it("迁移保留完整旧记录，不泄漏到公开设置，重复迁移不覆盖后续选择", async () => {
  const f = await fixture();
  try {
    await f.store.importLegacy("claude", {
      model: "a",
      reasoningEffort: "low",
      apiKey: "legacy-secret",
      unknown: 7,
    });
    const first = await f.service.readDefaults();
    expect(first.defaults).toEqual({ model: "a", effort: "low" });
    expect(first.unmappedLegacy).toEqual(["apiKey", "unknown"]);
    expect(JSON.stringify(first)).not.toContain("legacy-secret");
    await f.service.updateDefaults({ model: "b" });
    await f.store.importLegacy("claude", { model: "a", apiKey: "changed" });
    expect((await f.service.readDefaults()).defaults["model"]).toBe("b");
    expect(await readFile(join(f.root, "claude.json"), "utf8")).toContain("legacy-secret");
  } finally {
    await f.dispose();
  }
});

it("无需先打开设置页，新会话直接应用迁移默认值", async () => {
  const f = await fixture();
  const runtime = new AcpRuntime(
    f.root,
    withStorageCatalog({ catalog: () => Promise.reject(new Error("辅助会话不访问目录")) }),
    f.launch,
  );
  try {
    await runtime.settings.importLegacy("claude", { model: "b", reasoningEffort: "high" });
    const provider = runtime.forTemporary(f.root) as EngineProjectRouter;
    expect((await provider.listModels()).data).toHaveLength(2);
    // 默认模型是 Codex；按引擎请求以确认两者不会相互借用配置。
    expect(f.applied).not.toHaveBeenCalled();
    await provider.listModels("claude");
    expect(f.applied).toHaveBeenCalledWith("model", "b");
    expect(f.applied).toHaveBeenCalledWith("effort", "high");
  } finally {
    await runtime.close();
    await f.dispose();
  }
});

it("设置会话关闭失败时不提交默认值，关闭服务拒绝已排队操作", async () => {
  const f = await fixture();
  try {
    f.closed.mockImplementationOnce(() => {
      throw new Error("关闭失败");
    });
    await expect(f.service.updateDefaults({ model: "b" })).rejects.toThrow();
    expect((await f.store.read("claude")).values).toEqual({});
    const queued = f.service.inspect();
    const rejected = expect(queued).rejects.toThrow("关闭");
    await f.service.close();
    await rejected;
    await expect(f.service.readDefaults()).rejects.toThrow("关闭");
  } finally {
    await f.dispose();
  }
});

it("已保存的选项失效时仍可查看并修正设置，提交继续拒绝无效默认值", async () => {
  const f = await fixture();
  try {
    await f.store.update("claude", (saved) => ({
      ...saved,
      configured: true,
      values: { model: "removed" },
    }));
    expect(await f.service.readDefaults()).toMatchObject({
      defaults: { model: "removed" },
      invalidDefaults: ["model"],
      configOptions: initial,
    });
    await expect(f.service.updateDefaults({ model: "removed" })).rejects.toThrow("配置");
    expect(await f.service.updateDefaults({})).toMatchObject({ defaults: {}, invalidDefaults: [] });
  } finally {
    await f.dispose();
  }
});

it("取消认证回收独立连接且不阻塞后续设置，预先取消不启动 agent", async () => {
  const f = await fixture();
  const controller = new AbortController();
  controller.abort();
  try {
    await expect(f.service.authenticate("login", controller.signal)).rejects.toThrow();
    expect(f.launch).not.toHaveBeenCalled();
    const active = new AbortController();
    f.authenticate.mockImplementationOnce(
      ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              resolve({});
            },
            { once: true },
          );
        }),
    );
    const pending = f.service.authenticate("login", active.signal);
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => {
      expect(f.authenticate).toHaveBeenCalledOnce();
    });
    active.abort();
    await rejected;
    await expect(f.service.inspect()).resolves.toMatchObject({ engine: "claude" });
    expect(f.launch).toHaveBeenCalledTimes(2);
  } finally {
    await f.dispose();
  }
});

it("供应商设置经公共服务保存，新项目连接先恢复配置再创建会话", async () => {
  const f = await fixture();
  const runtime = new AcpRuntime(
    f.root,
    withStorageCatalog({ catalog: () => Promise.reject(new Error("不访问目录")) }),
    f.launch,
  );
  const config = {
    providerId: "main",
    apiType: "openai",
    baseUrl: "https://gateway.example",
    headers: { authorization: "Bearer secret" },
  };
  try {
    await expect(f.service.providers.configure(config)).resolves.toMatchObject({
      restartRequired: true,
    });
    await runtime.settings.update("claude", (saved) => ({ ...saved, providers: { main: config } }));
    f.routingSet.mockClear();
    await (runtime.forTemporary(f.root) as EngineProjectRouter).listModels("claude");
    expect(f.routingSet).toHaveBeenCalledOnce();
    await runtime.releaseProject("temporary");
    await runtime.settings.update("claude", (saved) => ({
      ...saved,
      providers: { main: { ...config, apiType: "unsupported" } },
    }));
    await expect(
      (runtime.forTemporary(f.root) as EngineProjectRouter).listModels("claude"),
    ).rejects.toThrow("协议");
  } finally {
    await runtime.close();
    await f.dispose();
  }
});

it("草稿服务协商完成后全局私有设置字节不变", async () => {
  const f = await fixture();
  try {
    await f.service.updateDefaults({ model: "a", effort: "low" });
    const before = JSON.stringify(await f.store.read("claude"));
    const write = vi.spyOn(f.store, "update");
    const result = await f.service.previewConfig(f.root, { values: { model: "b" } });
    expect(result.values["model"]).toBe("b");
    expect(JSON.stringify(await f.store.read("claude"))).toBe(before);
    expect(write).not.toHaveBeenCalled();
    expect(f.closed).toHaveBeenCalledTimes(2);
    const controller = new AbortController();
    f.transformOptions.mockImplementationOnce((_id, options) => {
      controller.abort();
      return options;
    });
    await expect(
      f.service.previewConfig(f.root, { values: { model: "b" } }, controller.signal),
    ).rejects.toThrow();
    expect(f.closed).toHaveBeenCalledTimes(3);
    expect(write).not.toHaveBeenCalled();
  } finally {
    await f.dispose();
  }
});

it("自动检测原生 API Key，显式刷新重读外部登录状态且不创建会话", async () => {
  const status = vi
    .fn()
    .mockReturnValueOnce({
      kind: "api_key",
      label: "Anthropic API key",
      detail: "ANTHROPIC_API_KEY",
    })
    .mockReturnValue({ kind: "none", label: "Not logged in" });
  const f = await fixture(status);
  try {
    expect((await f.service.inspect()).authStatus).toEqual({
      kind: "api_key",
      label: "Anthropic API key",
      detail: "ANTHROPIC_API_KEY",
    });
    expect((await f.service.inspect()).authStatus?.kind).toBe("none");
    expect(f.launch).toHaveBeenCalledTimes(2);
    expect(f.authenticate).not.toHaveBeenCalled();
    expect(f.closed).not.toHaveBeenCalled();
    expect(f.applied).not.toHaveBeenCalled();
  } finally {
    await f.dispose();
  }
});

it("API Key 必须随提交传到官方认证扩展，不能只发送 methodId", async () => {
  const f = await fixture();
  try {
    await f.service.authenticate("login", undefined, { apiKey: "test-key" });
    expect(f.authenticate.mock.calls.at(-1)?.[0].params).toMatchObject({
      methodId: "login",
      _meta: { "api-key": { apiKey: "test-key" } },
    });
  } finally {
    await f.dispose();
  }
});

it("当前连接优先展示应用覆盖，不被原生账号状态误标，且不回传密钥", async () => {
  const f = await fixture();
  const service = new AcpAgentService("claude", f.root, f.store, f.launch, undefined, () =>
    Promise.resolve({
      baseUrl: "https://native.example",
      apiType: "openai",
      headers: { Authorization: "Bearer native-secret" },
    }),
  );
  try {
    const native = await service.inspect();
    expect(native.connection).toMatchObject({
      source: "native",
      baseUrl: "https://native.example",
      hasCredentials: true,
    });
    await service.providers.configure({
      providerId: "main",
      apiType: "openai",
      baseUrl: "https://app.example",
      headers: { Authorization: "Bearer app-secret" },
    });
    const active = await service.inspect();
    expect(active.connection).toEqual({
      source: "application",
      providerId: "main",
      apiType: "openai",
      baseUrl: "https://app.example",
      hasCredentials: true,
    });
    expect(JSON.stringify(active)).not.toContain("app-secret");
  } finally {
    await service.close();
    await f.dispose();
  }
});

it("读取与联动预览不落盘，只有显式保存才创建用户配置", async () => {
  const f = await fixture();
  try {
    const path = join(f.store.directory, "claude.json");
    await f.service.inspect();
    await f.service.readDefaults();
    const preview = await f.service.previewConfig(f.root, {
      values: {},
      change: { configId: "model", value: "b" },
    });
    expect(preview.values["model"]).toBe("b");
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
    await f.service.updateDefaults(preview.values);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      configured: true,
      values: { model: "b" },
    });
  } finally {
    await f.dispose();
  }
});
