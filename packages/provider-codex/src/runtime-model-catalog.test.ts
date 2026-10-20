import { describe, expect, it, vi } from "vitest";

import { createCodexRuntimeProvider } from "./runtime-provider.test-support.js";
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
  it("uses the full CLI capabilities before the plain custom API catalog", async () => {
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
    const response = modelListResponse("gpt-6.1-sol");
    const model = response.data[0];
    if (model === undefined) throw new Error("Missing model fixture");
    model.defaultReasoningEffort = "low";
    model.supportedReasoningEfforts = ["low", "medium", "high", "xhigh", "max", "ultra"].map(
      (reasoningEffort) => ({ reasoningEffort, description: reasoningEffort }),
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "gpt-6.1-sol" }] })));
    const close = vi.fn(() => Promise.resolve());
    const runtime = createCodexRuntimeProvider({
      client: primary,
      fetch: fetchMock,
      modelCatalogRuntimeFactory: () =>
        Promise.resolve({ client: new FakeRpcClient([response]), close }),
    });
    const page = await runtime.listModels();
    expect(page.data[0]?.supportedReasoningEfforts.map((e) => e.id)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
    ]);
    expect(page.data[0]?.defaultReasoningEffort).toBe("low");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it.each(["error", "empty"])("uses the custom API only after a CLI %s result", async (failure) => {
    const primary = new FakeRpcClient([
      {
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
      },
    ]);
    const close = vi.fn(() => Promise.resolve());
    const catalog = new FakeRpcClient([
      failure === "error" ? new Error("offline") : { data: [], nextCursor: null },
    ]);
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => {
      expect(close).toHaveBeenCalledOnce();
      return Promise.resolve(new Response(JSON.stringify({ data: [{ id: "api-model" }] })));
    });
    const runtime = createCodexRuntimeProvider({
      client: primary,
      fetch: fetchMock,
      modelCatalogRuntimeFactory: () => Promise.resolve({ client: catalog, close }),
    });
    await expect(runtime.listModels()).resolves.toMatchObject({
      data: [{ id: "api-model", defaultReasoningEffort: "", supportedReasoningEfforts: [] }],
    });
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

it("does not reuse an official account catalog to configure an unavailable custom API", async () => {
  const primary = new FakeRpcClient([{ config: { model_provider: "openai" } }]);
  const factory = vi.fn(() =>
    Promise.resolve({
      client: new FakeRpcClient([modelListResponse("official")]),
      close: vi.fn(() => Promise.resolve()),
    }),
  );
  const runtime = createCodexRuntimeProvider({
    client: primary,
    fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")),
    modelCatalogRuntimeFactory: factory,
  });
  await expect(
    runtime.configureCustomProvider({ baseUrl: "https://new.example/v1", apiKey: "new-key" }),
  ).rejects.toThrow("No Agent models are available");
  expect(factory).not.toHaveBeenCalled();
});

it("refreshes capabilities after custom authentication and configuration succeed", async () => {
  const config = {
    config: {
      model_provider: "relay",
      suppress_unstable_features_warning: true,
      model_providers: {
        relay: {
          base_url: "https://relay.example/v1",
          model_catalog_url: "https://relay.example/catalog",
          requires_openai_auth: true,
        },
      },
    },
  };
  const primary = new FakeRpcClient([
    config,
    { account: { type: "apiKey" }, requiresOpenaiAuth: true },
    {},
    { imageGeneration: false, webSearch: true },
    {},
    { type: "apiKey" },
    config,
  ]);
  const response = modelListResponse("model");
  response.data[0]?.supportedReasoningEfforts.push({
    reasoningEffort: "ultra",
    description: "Maximum",
  });
  const factory = vi.fn(() => {
    expect(primary.calls.some((call) => call.method === "account/login/start")).toBe(true);
    return Promise.resolve({
      client: new FakeRpcClient([response]),
      close: vi.fn(() => Promise.resolve()),
    });
  });
  const runtime = createCodexRuntimeProvider({
    client: primary,
    modelCatalogRuntimeFactory: factory,
    fetch: vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "model" }] }))),
  });
  const result = await runtime.configureCustomProvider({
    baseUrl: "https://relay.example/v1",
    apiKey: "new-key",
    models: [{ id: "model", name: "My Model" }],
  });
  expect(result.models.data[0]).toMatchObject({
    displayName: "My Model",
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: [{ id: "low" }, { id: "high" }, { id: "ultra" }],
  });
  expect(factory).toHaveBeenCalledOnce();
});
