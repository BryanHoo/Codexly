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
  it("does not reuse another custom endpoint's CLI models during reconnect", async () => {
    const primary = new FakeRpcClient([
      {
        config: {
          model_provider: "relay",
          suppress_unstable_features_warning: true,
          model_providers: {
            relay: {
              base_url: "https://old.example/v1",
              model_catalog_url: "https://old.example/v1/models",
              requires_openai_auth: true,
            },
          },
        },
      },
      { account: { type: "apiKey" }, requiresOpenaiAuth: true },
      {},
      { imageGeneration: false, webSearch: false },
      {},
      { type: "apiKey" },
    ]);
    const factory = vi.fn(() =>
      Promise.resolve({
        client: new FakeRpcClient([modelListResponse("old-cli-model")]),
        close: vi.fn(() => Promise.resolve()),
      }),
    );
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    const cached = {
      data: [
        {
          id: "new-cached-model",
          displayName: "New Cache",
          description: "",
          isDefault: true,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [{ id: "medium", description: "" }],
        },
      ],
      nextCursor: null,
    };
    const runtime = createCodexRuntimeProvider({
      client: primary,
      fetch: fetchMock,
      modelCatalogRuntimeFactory: factory,
    });
    await expect(
      runtime.configureCustomProvider(
        { baseUrl: "https://new.example/v1", apiKey: "new-key" },
        cached,
      ),
    ).resolves.toMatchObject({ models: cached });
    expect(factory).not.toHaveBeenCalled();
  });
  it("queries the custom API before starting a CLI catalog process", async () => {
    const primary = new FakeRpcClient([
      {
        config: {
          model_provider: "relay",
          model_providers: {
            relay: { base_url: "https://relay.example/v1", requires_openai_auth: false },
          },
        },
      },
    ]);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "api-model" }] })));
    const factory = vi.fn(() =>
      Promise.resolve({ client: new FakeRpcClient([]), close: vi.fn(() => Promise.resolve()) }),
    );
    const runtime = createCodexRuntimeProvider({
      client: primary,
      fetch: fetchMock,
      modelCatalogRuntimeFactory: factory,
    });
    await expect(runtime.listModels()).resolves.toMatchObject({ data: [{ id: "api-model" }] });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://relay.example/v1/models",
      expect.objectContaining({ redirect: "manual" }),
    );
    expect(factory).not.toHaveBeenCalled();
  });

  it.each(["error", "empty"])("uses the CLI after a custom API %s result", async (failure) => {
    const config = {
      config: {
        model_provider: "relay",
        suppress_unstable_features_warning: true,
        model_providers: {
          relay: {
            base_url: "https://relay.example/v1",
            model_catalog_url: "https://relay.example/v1/models",
            requires_openai_auth: false,
          },
        },
      },
    };
    const primary = new FakeRpcClient([config]);
    const fetchMock = vi.fn<typeof fetch>();
    if (failure === "error") fetchMock.mockRejectedValue(new Error("offline"));
    else fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [] })));
    const catalog = new FakeRpcClient([modelListResponse("cli-model")]);
    const close = vi.fn(() => Promise.resolve());
    const factory = vi.fn(() => {
      expect(fetchMock).toHaveBeenCalledOnce();
      return Promise.resolve({ client: catalog, close });
    });
    const runtime = createCodexRuntimeProvider({
      client: primary,
      fetch: fetchMock,
      modelCatalogRuntimeFactory: factory,
    });
    await expect(runtime.listModels()).resolves.toMatchObject({ data: [{ id: "cli-model" }] });
    expect(close).toHaveBeenCalledOnce();
  });

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

  it("propagates fresh catalog failures without reviving the primary catalog", async () => {
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

    await expect(runtime.listModels()).rejects.toThrow("online catalog unavailable");
    expect(primary.calls).toEqual([{ method: "config/read", params: { includeLayers: false } }]);
    expect(close).toHaveBeenCalledOnce();
  });
});
