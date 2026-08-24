import { describe, expect, it, vi } from "vitest";

import { createCodexRuntimeProvider } from "./agent-provider.js";
import { CodexProviderConnectionService } from "./provider-connection.js";
import { FakeRpcClient } from "./provider-connection.test-support.js";

describe("Codex runtime native state", () => {
  it("coalesces cold-start config and account reads across runtime consumers", async () => {
    const client = new FakeRpcClient();
    const configResponse = {
      config: {
        approval_policy: "never",
        model: "gpt-5.6-sol",
        model_provider: "openai",
        model_reasoning_effort: "high",
      },
    };
    const accountResponse = {
      account: { email: "user@example.com", planType: "pro", type: "chatgpt" },
      requiresOpenaiAuth: true,
    };
    for (let index = 0; index < 3; index += 1) client.enqueue("config/read", configResponse);
    for (let index = 0; index < 2; index += 1) client.enqueue("account/read", accountResponse);
    const runtime = createCodexRuntimeProvider({ client });

    // 模拟模型目录、连接面板和全局设置在冷启动时分别读取相同原生状态。
    const [catalogConnection, panelConnection, defaults] = await Promise.all([
      runtime.readProviderConnection(),
      runtime.readProviderConnection(),
      runtime.readDefaultSettings(),
    ]);

    expect(catalogConnection).toEqual(panelConnection);
    expect(defaults).toMatchObject({
      approvalPolicy: "never",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
    });
    expect(client.requests).toEqual([
      { method: "config/read", params: { includeLayers: false } },
      { method: "account/read", params: { refreshToken: false } },
    ]);
  });

  it("refreshes native state after the short snapshot expires", async () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const client = new FakeRpcClient();
    client.enqueue("config/read", { config: { model_provider: "openai" } });
    client.enqueue("account/read", { account: null, requiresOpenaiAuth: true });
    client.enqueue("config/read", {
      config: {
        model_provider: "custom",
        model_providers: { custom: { base_url: "https://api.example.com/v1" } },
      },
    });
    client.enqueue("account/read", {
      account: { type: "apiKey" },
      requiresOpenaiAuth: true,
    });
    const service = new CodexProviderConnectionService(client);

    await expect(service.readStatus()).resolves.toMatchObject({ mode: "official" });
    await expect(service.readStatus()).resolves.toMatchObject({ mode: "official" });
    expect(client.requests).toHaveLength(2);
    now += 1_001;
    await expect(service.readStatus()).resolves.toMatchObject({
      customBaseUrl: "https://api.example.com/v1",
      mode: "custom",
      state: "connected",
    });
    expect(client.requests).toHaveLength(4);
  });

  it("invalidates native state immediately when Codex reports an account update", async () => {
    const client = new FakeRpcClient();
    client.enqueue("config/read", { config: { model_provider: "openai" } });
    client.enqueue("account/read", { account: null, requiresOpenaiAuth: true });
    client.enqueue("config/read", { config: { model_provider: "openai" } });
    client.enqueue("account/read", {
      account: { email: null, planType: "plus", type: "chatgpt" },
      requiresOpenaiAuth: true,
    });
    const service = new CodexProviderConnectionService(client);

    await expect(service.readStatus()).resolves.toMatchObject({ state: "disconnected" });
    service.receiveNotification("account/updated", { authMode: "chatgpt", planType: "plus" });
    await expect(service.readStatus()).resolves.toMatchObject({
      account: { planType: "plus", type: "chatgpt" },
      state: "connected",
    });
    expect(client.requests).toHaveLength(4);
  });

  it("does not cache an invalid native response", async () => {
    const client = new FakeRpcClient();
    client.enqueue("config/read", { config: null });
    client.enqueue("account/read", { account: null, requiresOpenaiAuth: true });
    client.enqueue("config/read", { config: { model_provider: "openai" } });
    const service = new CodexProviderConnectionService(client);

    await expect(service.readStatus()).rejects.toThrow("invalid config response");
    await expect(service.readStatus()).resolves.toMatchObject({
      mode: "official",
      state: "disconnected",
    });
    expect(client.requests).toEqual([
      { method: "config/read", params: { includeLayers: false } },
      { method: "account/read", params: { refreshToken: false } },
      { method: "config/read", params: { includeLayers: false } },
    ]);
  });
});
