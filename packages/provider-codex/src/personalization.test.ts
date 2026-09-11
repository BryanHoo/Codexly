import { describe, expect, it } from "vitest";
import { FakeRpcClient } from "./provider-connection.test-support.js";
import { readMemorySettings, updateMemorySettings, resetMemories } from "./personalization.js";

describe("personalization", () => {
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
            keyPath: "memories.no_memories_if_mcp_or_web_search",
            value: null,
            mergeStrategy: "replace",
          },
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
