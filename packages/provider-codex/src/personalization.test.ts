import { describe, expect, it } from "vitest";
import { FakeRpcClient } from "./provider-connection.test-support.js";
import { readMemorySettings, updateMemorySettings, resetMemories } from "./personalization.js";

describe("personalization", () => {
  it.each([
    { config: {}, enabled: false, allowExternalContext: true },
    {
      config: { features: undefined, memories: undefined },
      enabled: false,
      allowExternalContext: true,
    },
    { config: { features: null }, enabled: false, allowExternalContext: true },
    { config: { memories: null }, enabled: false, allowExternalContext: true },
    { config: { features: null, memories: null }, enabled: false, allowExternalContext: true },
    {
      config: { features: { memories: true }, memories: null },
      enabled: true,
      allowExternalContext: true,
    },
    {
      config: { features: null, memories: { disable_on_external_context: true } },
      enabled: false,
      allowExternalContext: false,
    },
  ])(
    "将缺失或空配置章节按默认值读取：$config",
    async ({ config, enabled, allowExternalContext }) => {
      const client = new FakeRpcClient();
      client.enqueue("config/read", { config });
      await expect(readMemorySettings(client)).resolves.toEqual({ enabled, allowExternalContext });
      expect(client.requests).toEqual([
        { method: "config/read", params: { includeLayers: false } },
      ]);
    },
  );

  it.each(["features", "memories"])("拒绝 %s 章节中的非空非法类型", async (key) => {
    for (const value of [false, 0, "", []]) {
      const client = new FakeRpcClient();
      client.enqueue("config/read", { config: { [key]: value } });
      await expect(readMemorySettings(client)).rejects.toThrow(`${key} must be an object`);
    }
  });

  it("写入后回读空章节时应用默认值，不清理记忆", async () => {
    const client = new FakeRpcClient();
    client.enqueue("config/read", { config: { features: { memories: true }, memories: null } });
    await expect(updateMemorySettings(client, { allowExternalContext: true })).resolves.toEqual({
      enabled: true,
      allowExternalContext: true,
    });
    expect(client.requests).toEqual([
      {
        method: "config/batchWrite",
        params: {
          edits: [
            {
              keyPath: "memories.disable_on_external_context",
              value: false,
              mergeStrategy: "replace",
            },
          ],
          reloadUserConfig: true,
        },
      },
      { method: "config/read", params: { includeLayers: false } },
    ]);
  });

  it("读取默认值，并原子更新记忆开关和外部上下文配置", async () => {
    const client = new FakeRpcClient();
    client.enqueue("config/read", { config: {} });
    await expect(readMemorySettings(client)).resolves.toEqual({
      enabled: false,
      allowExternalContext: true,
    });
    client.enqueue("config/read", {
      config: { features: { memories: true }, memories: { disable_on_external_context: true } },
    });
    await expect(
      updateMemorySettings(client, { enabled: true, allowExternalContext: false }),
    ).resolves.toEqual({ enabled: true, allowExternalContext: false });
    expect(client.requests[1]).toMatchObject({
      method: "config/batchWrite",
      params: {
        reloadUserConfig: true,
        edits: [
          { keyPath: "features.memories", value: true, mergeStrategy: "replace" },
          { keyPath: "memories.generate_memories", value: true, mergeStrategy: "replace" },
          { keyPath: "memories.use_memories", value: true, mergeStrategy: "replace" },
          {
            keyPath: "memories.disable_on_external_context",
            value: true,
            mergeStrategy: "replace",
          },
        ],
      },
    });
    await resetMemories(client);
    expect(client.requests.at(-1)).toEqual({ method: "memory/reset", params: null });
  });
});
