import type { ConfigureCustomProviderResponse } from "@codexly/protocol";
import { describe, expect, it, vi } from "vitest";

import { CodexProviderConnectionService } from "./provider-connection.js";
import { FakeRpcClient } from "./provider-connection.test-support.js";

describe("Codex provider model catalog configuration", () => {
  it("reports unavailable when discovery and the fallback catalog are both empty", async () => {
    const client = new FakeRpcClient();
    client.enqueue("config/batchWrite", {});
    client.enqueue("modelProvider/capabilities/read", {
      imageGeneration: true,
      webSearch: true,
    });
    client.enqueue("config/read", {
      config: {
        model_provider: "relay",
        model_providers: {
          relay: {
            base_url: "https://api.example.com/v1",
            name: "User Relay",
            requires_openai_auth: true,
            wire_api: "responses",
          },
        },
      },
    });
    client.enqueue("account/read", { account: { type: "apiKey" }, requiresOpenaiAuth: true });
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("missing API key"));
    const service = new CodexProviderConnectionService(client, { fetch: fetchMock });
    const persistedModels: ConfigureCustomProviderResponse["models"] = {
      data: [],
      nextCursor: null,
    };

    await expect(
      service.configureCustom({ baseUrl: "https://api.example.com/v1" }, persistedModels),
    ).rejects.toThrow("No Agent models are available");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("queries the fallback lazily only after the custom API fails", async () => {
    const client = new FakeRpcClient();
    client.enqueue("config/read", {
      config: {
        model_provider: "relay",
        model_providers: {
          relay: { base_url: "https://api.example.com/v1", requires_openai_auth: false },
        },
      },
    });
    client.enqueue("account/read", { account: null, requiresOpenaiAuth: false });
    client.enqueue("config/batchWrite", {});
    client.enqueue("modelProvider/capabilities/read", { imageGeneration: false, webSearch: false });
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    const page: ConfigureCustomProviderResponse["models"] = {
      data: [
        {
          id: "fallback",
          displayName: "Fallback",
          description: "",
          isDefault: true,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [{ id: "medium", description: "" }],
        },
      ],
      nextCursor: null,
    };
    const fallback = vi.fn(() => {
      expect(fetchMock).toHaveBeenCalledOnce();
      return Promise.resolve(page);
    });
    const service = new CodexProviderConnectionService(client, { fetch: fetchMock });
    await expect(
      service.configureCustom({ baseUrl: "https://api.example.com/v1" }, fallback),
    ).resolves.toMatchObject({ models: page });
    expect(fallback).toHaveBeenCalledOnce();
  });

  it("upgrades a legacy custom provider before startup model refresh", async () => {
    const client = new FakeRpcClient();
    client.enqueue("config/read", {
      config: {
        model_provider: "relay",
        model_providers: {
          relay: {
            base_url: "https://api.example.com/v1",
            name: "User Relay",
            requires_openai_auth: true,
            wire_api: "responses",
          },
        },
      },
    });
    client.enqueue("config/batchWrite", {});
    const service = new CodexProviderConnectionService(client);

    await service.prepareModelCatalog();

    expect(client.requests.at(-1)).toEqual({
      method: "config/batchWrite",
      params: {
        edits: [
          {
            keyPath: "model_providers.relay",
            mergeStrategy: "upsert",
            value: {
              base_url: "https://api.example.com/v1",
              model_catalog_url: "https://api.example.com/v1/models",
              name: "User Relay",
              requires_openai_auth: true,
              wire_api: "responses",
            },
          },
          {
            keyPath: "features.api_key_model_discovery",
            mergeStrategy: "upsert",
            value: true,
          },
          {
            keyPath: "suppress_unstable_features_warning",
            mergeStrategy: "upsert",
            value: true,
          },
        ],
      },
    });
  });

  it("suppresses the warning for an already current custom model catalog", async () => {
    const client = new FakeRpcClient();
    client.enqueue("config/read", {
      config: {
        features: {},
        model_provider: "relay",
        model_providers: {
          relay: {
            base_url: "https://api.example.com/v1",
            model_catalog_url: "https://api.example.com/v1/models",
            name: "User Relay",
            requires_openai_auth: true,
            wire_api: "responses",
          },
        },
      },
    });
    const service = new CodexProviderConnectionService(client);
    client.enqueue("config/batchWrite", {});

    await service.prepareModelCatalog();

    expect(client.requests.at(-1)).toEqual({
      method: "config/batchWrite",
      params: {
        edits: [
          { keyPath: "suppress_unstable_features_warning", mergeStrategy: "upsert", value: true },
        ],
      },
    });
  });

  it("does not rewrite a current catalog with its warning already suppressed", async () => {
    const client = new FakeRpcClient();
    client.enqueue("config/read", {
      config: {
        features: {},
        model_provider: "relay",
        model_providers: {
          relay: {
            base_url: "https://api.example.com/v1",
            model_catalog_url: "https://api.example.com/v1/models",
          },
        },
        suppress_unstable_features_warning: true,
      },
    });
    const service = new CodexProviderConnectionService(client);

    await service.prepareModelCatalog();

    expect(client.requests).toEqual([{ method: "config/read", params: { includeLayers: false } }]);
  });
});

it("preserves a separate native catalog URL during preparation and reconnect", async () => {
  const config = {
    model_provider: "relay",
    suppress_unstable_features_warning: true,
    model_providers: {
      relay: {
        base_url: "https://api.example.com/v1",
        model_catalog_url: "https://api.example.com/codex/models.json",
        requires_openai_auth: false,
      },
    },
  };
  const client = new FakeRpcClient();
  client.enqueue("config/read", { config });
  const service = new CodexProviderConnectionService(client);
  await service.prepareModelCatalog();
  expect(client.requests).toEqual([{ method: "config/read", params: { includeLayers: false } }]);
});
