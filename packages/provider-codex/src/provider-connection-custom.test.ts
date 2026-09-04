import type { ConfigureCustomProviderResponse } from "@codexly/protocol";
import { describe, expect, it, vi } from "vitest";
import { CodexProviderConnectionService } from "./provider-connection.js";
import { FakeRpcClient } from "./provider-connection.test-support.js";

describe("Codex custom provider connection", () => {
  it("accepts an empty reconnect catalog without requesting the remote endpoint", async () => {
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
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reconnects the selected custom provider without changing model_provider", async () => {
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
            base_url: "https://old.example.com/v1",
            name: "User Relay",
            requires_openai_auth: true,
            wire_api: "responses",
          },
        },
      },
    });
    client.enqueue("account/read", { account: { type: "apiKey" }, requiresOpenaiAuth: true });
    const service = new CodexProviderConnectionService(client, {
      fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error("model discovery unavailable")),
    });

    await service.configureCustom({
      baseUrl: "https://new.example.com/v1",
      models: [{ id: "custom-model", name: "Custom Model" }],
    });

    expect(client.requests.find((request) => request.method === "config/batchWrite")).toEqual({
      method: "config/batchWrite",
      params: {
        edits: [
          {
            keyPath: "model_providers.relay",
            mergeStrategy: "upsert",
            value: {
              base_url: "https://new.example.com/v1",
              name: "User Relay",
              requires_openai_auth: true,
              wire_api: "responses",
            },
          },
        ],
      },
    });
  });

  it("updates openai_base_url when reconnecting an openai override", async () => {
    const client = new FakeRpcClient();
    client.enqueue("config/batchWrite", {});
    client.enqueue("modelProvider/capabilities/read", {
      imageGeneration: true,
      namespaceTools: true,
      webSearch: true,
    });
    client.enqueue("config/read", {
      config: {
        model_provider: "openai",
        openai_base_url: "https://old.example.com/v1",
      },
    });
    client.enqueue("account/read", { account: { type: "apiKey" }, requiresOpenaiAuth: true });
    const service = new CodexProviderConnectionService(client, {
      fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error("model discovery unavailable")),
    });

    await service.configureCustom({
      baseUrl: "https://new.example.com/v1",
      models: [{ id: "custom-model", name: "Custom Model" }],
    });

    expect(client.requests.find((request) => request.method === "config/batchWrite")).toEqual({
      method: "config/batchWrite",
      params: {
        edits: [
          {
            keyPath: "openai_base_url",
            mergeStrategy: "upsert",
            value: "https://new.example.com/v1",
          },
        ],
      },
    });
  });

  it("creates OpenAI as the default custom provider", async () => {
    const client = new FakeRpcClient();
    client.enqueue("config/batchWrite", {});
    client.enqueue("modelProvider/capabilities/read", {
      imageGeneration: true,
      namespaceTools: true,
      webSearch: true,
    });
    client.enqueue("config/read", { config: {} });
    client.enqueue("account/read", { account: null, requiresOpenaiAuth: false });
    const service = new CodexProviderConnectionService(client, {
      fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error("model discovery unavailable")),
    });

    await service.configureCustom({
      baseUrl: "https://api.example.com/v1",
      models: [{ id: "custom-model", name: "Custom Model" }],
    });

    expect(client.requests.find((request) => request.method === "config/batchWrite")).toEqual({
      method: "config/batchWrite",
      params: {
        edits: [
          {
            keyPath: "model_providers.OpenAI",
            mergeStrategy: "upsert",
            value: {
              base_url: "https://api.example.com/v1",
              name: "OpenAI",
              requires_openai_auth: false,
              wire_api: "responses",
            },
          },
          {
            keyPath: "model_provider",
            mergeStrategy: "upsert",
            value: "OpenAI",
          },
        ],
      },
    });
  });

  it("discovers custom models and keeps the API key out of Codex config", async () => {
    const client = new FakeRpcClient();
    client.enqueue("account/login/start", { type: "apiKey" });
    client.enqueue("config/batchWrite", {});
    client.enqueue("modelProvider/capabilities/read", {
      imageGeneration: true,
      namespaceTools: true,
      webSearch: true,
    });
    client.enqueue("config/read", {
      config: {
        model_provider: "OpenAI",
        model_providers: {
          OpenAI: { base_url: "https://api.example.com/v1" },
        },
      },
    });
    client.enqueue("account/read", { account: { type: "apiKey" }, requiresOpenaiAuth: true });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [
            {
              default_reasoning_level: "ultra",
              display_name: "Zeta",
              slug: "zeta",
              supported_reasoning_levels: [
                { description: "Low", effort: "low" },
                { description: "Maximum", effort: "max" },
                { description: "Proactive", effort: "ultra" },
                { description: "Provider defined", effort: "focused" },
              ],
            },
            {
              default_reasoning_level: "medium",
              display_name: "Alpha",
              slug: "alpha",
              supported_reasoning_levels: [{ description: "Medium", effort: "medium" }],
            },
          ],
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      ),
    );
    const service = new CodexProviderConnectionService(client, { fetch: fetchMock });

    await expect(
      service.configureCustom({
        apiKey: "custom-secret",
        baseUrl: "https://api.example.com/v1/",
        models: [
          { id: "manual-model", name: "Manual Model" },
          { id: " alpha ", name: "Alpha Custom" },
        ],
      }),
    ).resolves.toMatchObject({
      models: {
        data: [
          {
            displayName: "Alpha Custom",
            id: "alpha",
            isDefault: true,
            supportedReasoningEfforts: [{ description: "Medium", id: "medium" }],
          },
          { displayName: "Manual Model", id: "manual-model", isDefault: false },
          {
            defaultReasoningEffort: "ultra",
            displayName: "Zeta",
            id: "zeta",
            isDefault: false,
            supportedReasoningEfforts: [
              { description: "Low", id: "low" },
              { description: "Maximum", id: "max" },
              { description: "Proactive", id: "ultra" },
              { description: "Provider defined", id: "focused" },
            ],
          },
        ],
      },
      status: { customBaseUrl: "https://api.example.com/v1", state: "connected" },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/v1/models",
      expect.objectContaining({
        headers: { authorization: "Bearer custom-secret" },
        redirect: "manual",
      }),
    );
    const configRequest = client.requests.find((request) => request.method === "config/batchWrite");
    expect(JSON.stringify(configRequest)).not.toContain("custom-secret");
    expect(configRequest).toEqual({
      method: "config/batchWrite",
      params: {
        edits: [
          {
            keyPath: "model_providers.OpenAI",
            mergeStrategy: "upsert",
            value: {
              base_url: "https://api.example.com/v1",
              name: "OpenAI",
              requires_openai_auth: true,
              wire_api: "responses",
            },
          },
        ],
      },
    });
    expect(client.requests).toContainEqual({
      method: "modelProvider/capabilities/read",
      params: {},
    });
  });

  it("uses manually configured models when the custom model endpoint is unavailable", async () => {
    const client = new FakeRpcClient();
    client.enqueue("config/batchWrite", {});
    client.enqueue("modelProvider/capabilities/read", {
      imageGeneration: true,
      namespaceTools: true,
      webSearch: true,
    });
    client.enqueue("config/read", {
      config: {
        model_provider: "OpenAI",
        model_providers: {
          OpenAI: { base_url: "http://localhost:11434/v1" },
        },
      },
    });
    client.enqueue("account/read", { account: null, requiresOpenaiAuth: false });
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("not supported"));
    const service = new CodexProviderConnectionService(client, { fetch: fetchMock });

    await expect(
      service.configureCustom({
        baseUrl: "http://localhost:11434/v1",
        models: [
          { id: " local-model ", name: "Local Model" },
          { id: "local-model", name: "Local Model Override" },
          { id: "other-model", name: "Other Model" },
        ],
      }),
    ).resolves.toMatchObject({
      models: {
        data: [
          {
            defaultReasoningEffort: "medium",
            displayName: "Local Model Override",
            id: "local-model",
            isDefault: true,
            supportedReasoningEfforts: [{ description: "", id: "medium" }],
          },
          {
            defaultReasoningEffort: "medium",
            displayName: "Other Model",
            id: "other-model",
            isDefault: false,
            supportedReasoningEfforts: [{ description: "", id: "medium" }],
          },
        ],
      },
      status: { mode: "custom", state: "connected" },
    });
  });

  it("uses a conservative reasoning default for standard OpenAI model catalogs", async () => {
    const client = new FakeRpcClient();
    client.enqueue("config/batchWrite", {});
    client.enqueue("modelProvider/capabilities/read", {
      imageGeneration: true,
      namespaceTools: true,
      webSearch: true,
    });
    client.enqueue("config/read", {
      config: {
        model_provider: "OpenAI",
        model_providers: {
          OpenAI: { base_url: "https://api.example.com/v1" },
        },
      },
    });
    client.enqueue("account/read", { account: null, requiresOpenaiAuth: false });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [{ id: "plain-model" }] }), { status: 200 }),
      );
    const service = new CodexProviderConnectionService(client, { fetch: fetchMock });

    await expect(
      service.configureCustom({ baseUrl: "https://api.example.com/v1" }),
    ).resolves.toMatchObject({
      models: {
        data: [
          {
            defaultReasoningEffort: "medium",
            id: "plain-model",
            supportedReasoningEfforts: [{ description: "", id: "medium" }],
          },
        ],
      },
    });
  });
});
