import type { ConfigureCustomProviderResponse } from "@codexly/protocol";
import { describe, expect, it, vi } from "vitest";

import { CodexProviderConnectionService } from "./provider-connection.js";
import { FakeRpcClient } from "./provider-connection.test-support.js";

describe("Codex provider model catalog configuration", () => {
  it("falls back to an empty reconnect catalog when refreshing the remote endpoint fails", async () => {
    const client = new FakeRpcClient();
    client.enqueue("config/batchWrite", {});
    client.enqueue("modelProvider/capabilities/read", {
      imageGeneration: true,
      namespaceTools: true,
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
    ).resolves.toMatchObject({ models: persistedModels });
    expect(fetchMock).toHaveBeenCalledOnce();
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
