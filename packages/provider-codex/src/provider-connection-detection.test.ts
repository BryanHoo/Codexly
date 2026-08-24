import { describe, expect, it } from "vitest";
import { CodexProviderConnectionService } from "./provider-connection.js";
import { FakeRpcClient, enqueueOfficialStatus } from "./provider-connection.test-support.js";

describe("Codex provider connection detection", () => {
  it("detects a custom provider selected in the Codex CLI config", async () => {
    const client = new FakeRpcClient();
    client.enqueue("config/read", {
      config: {
        model_provider: "OpenAI",
        model_providers: {
          OpenAI: {
            base_url: "http://api.example.test:8080/v1",
            requires_openai_auth: true,
            wire_api: "responses",
          },
        },
      },
    });
    client.enqueue("account/read", {
      account: { type: "apiKey" },
      requiresOpenaiAuth: true,
    });
    const service = new CodexProviderConnectionService(client);

    await expect(service.readStatus()).resolves.toMatchObject({
      customBaseUrl: "http://api.example.test:8080/v1",
      mode: "custom",
      state: "connected",
    });
  });

  it("detects openai_base_url as a custom API configuration", async () => {
    const client = new FakeRpcClient();
    client.enqueue("config/read", {
      config: {
        model_provider: "openai",
        openai_base_url: "https://gateway.example.test/v1",
      },
    });
    client.enqueue("account/read", {
      account: { type: "apiKey" },
      requiresOpenaiAuth: true,
    });
    const service = new CodexProviderConnectionService(client);

    await expect(service.readStatus()).resolves.toMatchObject({
      customBaseUrl: "https://gateway.example.test/v1",
      mode: "custom",
      state: "connected",
    });
  });

  it("starts official login and tracks a failed completion notification", async () => {
    const client = new FakeRpcClient();
    client.enqueue("config/batchWrite", {});
    client.enqueue("account/login/start", {
      authUrl: "https://auth.openai.com/authorize",
      loginId: "login-1",
      type: "chatgpt",
    });
    enqueueOfficialStatus(client);
    const service = new CodexProviderConnectionService(client);

    await expect(service.startOfficialLogin()).resolves.toMatchObject({
      authUrl: "https://auth.openai.com/authorize",
      loginId: "login-1",
      status: { mode: "official", state: "pending" },
    });
    expect(client.requests[0]).toEqual({
      method: "config/batchWrite",
      params: {
        edits: [
          { keyPath: "model_provider", mergeStrategy: "upsert", value: "openai" },
          { keyPath: "openai_base_url", mergeStrategy: "replace", value: null },
        ],
      },
    });

    service.receiveNotification("account/login/completed", {
      error: "browser login expired",
      loginId: "login-1",
      success: false,
    });
    enqueueOfficialStatus(client);
    await expect(service.readStatus()).resolves.toMatchObject({
      pendingLogin: {
        error: "browser login expired",
        loginId: "login-1",
        state: "failed",
      },
      state: "failed",
    });
  });
});
