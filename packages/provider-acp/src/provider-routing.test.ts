import * as acp from "@agentclientprotocol/sdk/unstable";
import { expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AcpConnection } from "./connection.js";
import { AcpSettingsStore } from "./settings-store.js";
import { AcpProviderRouting } from "./provider-routing.js";

async function fixture(enabled = true) {
  const root = await mkdtemp(join(tmpdir(), "acp-routing-"));
  const a = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
  const b = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
  let current: acp.ProviderCurrentConfig | null = null;
  const set = vi.fn(({ params }: acp.AgentRequestContext<acp.SetProviderRequest>) => {
    if (params.baseUrl === "https://failed.example") throw acp.RequestError.invalidParams();
    current = { apiType: params.apiType, baseUrl: params.baseUrl };
    return {};
  });
  const disable = vi.fn(() => {
    current = null;
    return {};
  });
  const peer = acp
    .agent({ name: "routing" })
    .onRequest(acp.methods.agent.initialize, () => ({
      protocolVersion: 1,
      agentCapabilities: enabled ? { providers: {} } : {},
    }))
    .onRequest(acp.methods.agent.providers.list, () => ({
      providers: [
        { providerId: "main", required: true, supported: ["openai"], current: null },
        { providerId: "gateway", required: false, supported: ["openai"], current },
      ],
    }))
    .onRequest(acp.methods.agent.providers.set, set)
    .onRequest(acp.methods.agent.providers.disable, disable)
    .connect({ readable: a.readable, writable: b.writable });
  const connection = await AcpConnection.connect({ readable: b.readable, writable: a.writable });
  const store = new AcpSettingsStore(root);
  const routing = new AcpProviderRouting("claude", store);
  return {
    root,
    connection,
    store,
    routing,
    set,
    disable,
    async close() {
      connection.close();
      peer.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

it("供应商配置精确使用 ACP 标识和协议，私有保存 headers，公开响应不回显", async () => {
  const f = await fixture();
  try {
    const config = {
      providerId: "gateway",
      apiType: "openai",
      baseUrl: "https://gateway.example",
      headers: { authorization: "Bearer private-secret" },
    };
    expect(await f.routing.configure(f.connection, config)).toMatchObject({
      restartRequired: true,
      providers: [
        { providerId: "main" },
        { providerId: "gateway", current: { baseUrl: config.baseUrl } },
      ],
    });
    expect(f.set.mock.calls[0]?.[0].params).toEqual(config);
    expect(JSON.stringify(await f.routing.list(f.connection))).not.toContain("private-secret");
    expect(await readFile(join(f.root, "claude.json"), "utf8")).toContain("private-secret");
    await expect(
      f.routing.configure(f.connection, { ...config, baseUrl: "https://failed.example" }),
    ).rejects.toThrow();
    expect((await f.store.read("claude")).providers?.["gateway"]?.baseUrl).toBe(config.baseUrl);
    f.set.mockClear();
    await new AcpProviderRouting("claude", f.store).restore(f.connection);
    expect(f.set.mock.calls[0]?.[0].params).toEqual(config);
    await expect(f.routing.disable(f.connection, "main")).rejects.toThrow("必需");
    expect(f.disable).not.toHaveBeenCalled();
    await f.routing.disable(f.connection, "gateway");
    expect((await f.store.read("claude")).providers).toEqual({});
    f.disable.mockClear();
    await new AcpProviderRouting("claude", f.store).restore(f.connection);
    expect(f.disable).toHaveBeenCalledOnce();
  } finally {
    await f.close();
  }
});

it("未协商、不存在的供应商与协议不触发配置请求", async () => {
  const f = await fixture(false);
  try {
    await expect(f.routing.list(f.connection)).rejects.toThrow("不支持");
    await expect(
      f.routing.configure(f.connection, {
        providerId: "gateway",
        apiType: "openai",
        baseUrl: "https://gateway.example",
      }),
    ).rejects.toThrow("不支持");
    expect(f.set).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});
