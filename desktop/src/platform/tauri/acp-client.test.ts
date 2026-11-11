import { expect, it, vi } from "vitest";
import { TauriCatalogClient } from "./catalog-client.js";
import type { InvokeImplementation } from "./native-client.js";

it("原生计划 ACP 设置直接使用本地命令，配置操作不启动旧引擎",async()=>{
  const view={projectId:"p",canEdit:true,config:{engine:"claude",values:{mode:false},revision:1}};
  const invoke=vi.fn(async()=>view);
  const ensureRuntime=vi.fn(async()=>undefined);
  const client=new TauriCatalogClient({invoke:invoke as InvokeImplementation,ensureRuntime});
  const input={projectId:"p",engine:"claude" as const,values:{mode:false},expectedRevision:0,confirmMigration:true};
  expect(await client.getAcpScheduledConfig("plan")).toEqual(view);
  expect(await client.setAcpScheduledConfig("plan",input)).toEqual(view);
  expect(invoke).toHaveBeenCalledWith("read_acp_scheduled_config",{taskId:"plan"});
  expect(invoke).toHaveBeenCalledWith("set_acp_scheduled_config",{taskId:"plan",input});
  expect(ensureRuntime).not.toHaveBeenCalled();
});

it("ACP 全局读取和布尔配置写入直接调用原生白名单，不初始化旧引擎", async () => {
  const invoke = vi.fn(async () => ({}));
  const ensureRuntime = vi.fn(async () => undefined);
  const client = new TauriCatalogClient({ invoke: invoke as InvokeImplementation, ensureRuntime });
  await client.getAcpAgent("claude");
  await client.updateAcpDefaults("codex", { enabled: false });
  await client.setAcpDefaultConfig("claude", "enabled", false);
  expect(ensureRuntime).not.toHaveBeenCalled();
  expect(invoke).toHaveBeenCalledWith("acp_agent_request", {
    engine: "claude",
    method: "agent.inspect",
    params: {},
  });
  expect(invoke).toHaveBeenCalledWith("acp_agent_request", {
    engine: "codex",
    method: "settings.write",
    params: { values: { enabled: false } },
  });
  expect(invoke).toHaveBeenCalledWith("acp_agent_request", {
    engine: "claude",
    method: "settings.config.write",
    params: { configId: "enabled", value: false },
  });
});

it("认证取消发送原请求身份，不关闭其他任务", async () => {
  const invoke = vi.fn((command: string) =>
    command === "acp_agent_request" ? new Promise(() => undefined) : Promise.resolve({}),
  );
  const client = new TauriCatalogClient({
    invoke: invoke as InvokeImplementation,
    ensureRuntime: vi.fn(async () => undefined),
  });
  const controller = new AbortController();
  const request = client.authenticateAcpAgent("claude", "oauth", { signal: controller.signal });
  await vi.waitFor(() =>
    expect(invoke).toHaveBeenCalledWith(
      "acp_agent_request",
      expect.objectContaining({ requestId: expect.any(String) }),
    ),
  );
  controller.abort();
  await expect(request).rejects.toMatchObject({ name: "AbortError" });
  expect(invoke).toHaveBeenCalledWith(
    "cancel_native_request",
    expect.objectContaining({ requestId: expect.any(String) }),
  );
});

it("预先取消的配置写入不提交", async () => {
  const invoke = vi.fn(async () => ({}));
  const client = new TauriCatalogClient({ invoke: invoke as InvokeImplementation });
  const controller = new AbortController();
  controller.abort();
  await expect(
    client.updateAcpDefaults("codex", {}, { signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(invoke).not.toHaveBeenCalled();
});

it("草稿预览只传项目身份、配置和值，不启动旧 Codex", async () => {
  const invoke = vi.fn(async()=>({configOptions:[],values:{enabled:false}}));
  const ensureRuntime=vi.fn();
  const client=new TauriCatalogClient({invoke:invoke as never,ensureRuntime,connectEvents:()=>Promise.resolve()});
  await client.previewAcpConfig("p","claude",{values:{enabled:false}});
  expect(invoke).toHaveBeenCalledWith("acp_agent_request",{engine:"claude",method:"settings.preview",params:{projectId:"p",values:{enabled:false}}});
  expect(ensureRuntime).not.toHaveBeenCalled();
});
