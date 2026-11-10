import * as acp from "@agentclientprotocol/sdk/unstable";
import { expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
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
async function fixture() {
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
  const routingSet = vi.fn(() => ({}));
  let sequence = 0;
  const launch = vi.fn<AcpAgentLauncher>(async (_engine, _scope, callbacks) => {
    const a = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
    const b = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
    const sessions = new Map<string, acp.SessionConfigOption[]>();
    const peer = acp
      .agent({ name: "test" })
      .onRequest(acp.methods.agent.initialize, () => ({
        protocolVersion: 1,
        authMethods: [
          { id: "login", name: "登录" },
          { id: "fail", name: "失败" },
          { id: "terminal", name: "终端", type: "terminal" as const },
        ],
        agentCapabilities: { sessionCapabilities: { close: {} }, providers: {} },
      }))
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
        if (params.configId === "model") {
          const effort = options[1];
          if (effort?.type === "select")
            effort.options = [
              { value: "low", name: "低" },
              { value: "high", name: "高" },
            ];
        }
        return { configOptions: options };
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
    routingSet,
    closed,
    launch,
    async dispose() {
      await service.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

it("认证仅调用公布的 agent 方法，终端认证与失败不得伪装成功", async () => {
  const f = await fixture();
  try {
    expect(f.launch).not.toHaveBeenCalled();
    expect(await f.service.inspect()).toMatchObject({
      engine: "claude",
      protocolVersion: 1,
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
    { catalog: () => Promise.reject(new Error("辅助会话不访问目录")) },
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
    { catalog: () => Promise.reject(new Error("不访问目录")) },
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
