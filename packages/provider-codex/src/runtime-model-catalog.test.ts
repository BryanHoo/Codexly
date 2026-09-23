import { describe, expect, it, vi } from "vitest";

import { createCodexRuntimeProvider } from "./agent-provider.js";
import { FakeRpcClient } from "./agent-provider.test-support.js";

function modelListResponse(model: string) {
  return {
    data: [
      {
        defaultReasoningEffort: "high",
        description: `${model} description`,
        displayName: model,
        hidden: false,
        isDefault: true,
        model,
        multiAgentVersion: "v2",
        supportedReasoningEfforts: [
          { description: "Fast", reasoningEffort: "low" },
          { description: "Deep", reasoningEffort: "high" },
        ],
      },
    ],
    nextCursor: null,
  };
}

describe("CodexRuntimeProvider model catalog", () => {
  it("uses a fresh App Server catalog before the primary CLI catalog", async () => {
    const primary = new FakeRpcClient([
      { config: { model_provider: "openai" } },
      modelListResponse("cli-model"),
    ]);
    const catalog = new FakeRpcClient([modelListResponse("online-model")]);
    const close = vi.fn(() => Promise.resolve());
    const runtime = createCodexRuntimeProvider({
      client: primary,
      modelCatalogRuntimeFactory: () => Promise.resolve({ client: catalog, close }),
    });

    await expect(runtime.listModels()).resolves.toMatchObject({
      data: [{ defaultReasoningEffort: "high", id: "online-model" }],
    });
    expect(primary.calls).toEqual([{ method: "config/read", params: { includeLayers: false } }]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("falls back to the primary CLI catalog when fresh catalog loading fails", async () => {
    const primary = new FakeRpcClient([
      { config: { model_provider: "openai" } },
      modelListResponse("cli-model"),
    ]);
    const catalog = new FakeRpcClient([new Error("online catalog unavailable")]);
    const close = vi.fn(() => Promise.resolve());
    const runtime = createCodexRuntimeProvider({
      client: primary,
      logger: { warn: vi.fn() },
      modelCatalogRuntimeFactory: () => Promise.resolve({ client: catalog, close }),
    });

    await expect(runtime.listModels()).resolves.toMatchObject({ data: [{ id: "cli-model" }] });
    expect(primary.calls).toEqual([
      { method: "config/read", params: { includeLayers: false } },
      { method: "model/list", params: { includeHidden: false, limit: 100 } },
    ]);
    expect(close).toHaveBeenCalledOnce();
  });
});
