import { describe, expect, it } from "vitest";

import { CodexProviderConnectionService } from "./provider-connection.js";
import { FakeRpcClient } from "./provider-connection.test-support.js";

describe("Codex provider model catalog configuration", () => {
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
        ],
      },
    });
  });

  it("does not rewrite an already current custom model catalog configuration", async () => {
    const client = new FakeRpcClient();
    client.enqueue("config/read", {
      config: {
        features: { api_key_model_discovery: true },
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

    await service.prepareModelCatalog();

    expect(client.requests).toEqual([{ method: "config/read", params: { includeLayers: false } }]);
  });
});
