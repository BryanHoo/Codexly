import { describe, expect, it, vi } from "vitest";
import { CodexProviderConnectionService } from "./provider-connection.js";
import { FakeRpcClient, enqueueOfficialStatus } from "./provider-connection.test-support.js";

describe("Codex provider connection failures", () => {
  it("rejects invalid capabilities after activating a custom provider", async () => {
    const client = new FakeRpcClient();
    client.enqueue("config/read", {
      config: {
        model_provider: "existing_provider",
        model_providers: {
          codexly_custom: {
            base_url: "https://previous.example.com/v1",
            name: "Previous Custom API",
            requires_openai_auth: false,
            wire_api: "responses",
          },
          existing_provider: {
            base_url: "https://existing.example.com/v1",
          },
        },
      },
    });
    client.enqueue("account/read", { account: { type: "chatgpt" }, requiresOpenaiAuth: true });
    client.enqueue("config/batchWrite", {});
    client.enqueue("modelProvider/capabilities/read", { namespaceTools: true });
    client.enqueue("config/batchWrite", {});
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [{ id: "plain-model" }] }), { status: 200 }),
      );
    const service = new CodexProviderConnectionService(client, { fetch: fetchMock });

    await expect(
      service.configureCustom({ apiKey: "replacement-key", baseUrl: "https://api.example.com/v1" }),
    ).rejects.toThrow("Codex returned invalid model provider capabilities");
    expect(client.requests).not.toContainEqual({
      method: "account/login/start",
      params: { apiKey: "replacement-key", type: "apiKey" },
    });
    expect(client.requests.at(-1)).toEqual({
      method: "config/batchWrite",
      params: {
        edits: [
          {
            keyPath: "model_providers.codexly_custom",
            mergeStrategy: "replace",
            value: {
              base_url: "https://previous.example.com/v1",
              name: "Previous Custom API",
              requires_openai_auth: false,
              wire_api: "responses",
            },
          },
          {
            keyPath: "model_provider",
            mergeStrategy: "replace",
            value: "existing_provider",
          },
        ],
      },
    });
  });

  it("restores the previous config when custom API key login fails", async () => {
    const client = new FakeRpcClient();
    enqueueOfficialStatus(client, { type: "chatgpt" });
    client.enqueue("config/batchWrite", {});
    client.enqueue("modelProvider/capabilities/read", {
      imageGeneration: true,
      namespaceTools: true,
      webSearch: true,
    });
    client.enqueue("account/login/start", new Error("API key login failed"));
    client.enqueue("config/batchWrite", {});
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [{ id: "plain-model" }] }), { status: 200 }),
      );
    const service = new CodexProviderConnectionService(client, { fetch: fetchMock });

    await expect(
      service.configureCustom({ apiKey: "invalid-key", baseUrl: "https://api.example.com/v1" }),
    ).rejects.toThrow("API key login failed");
    expect(client.requests.at(-1)).toEqual({
      method: "config/batchWrite",
      params: {
        edits: [
          {
            keyPath: "model_providers.codexly_custom",
            mergeStrategy: "replace",
            value: null,
          },
          { keyPath: "model_provider", mergeStrategy: "replace", value: "openai" },
        ],
      },
    });
  });

  it("times out after response headers while the model response body remains open", async () => {
    vi.useFakeTimers();
    const client = new FakeRpcClient();
    const requestState: {
      signal: AbortSignal | null;
      streamController: ReadableStreamDefaultController<Uint8Array> | null;
    } = { signal: null, streamController: null };
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      requestState.signal = init?.signal ?? null;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          requestState.streamController = controller;
          // 模拟服务端先返回响应头和部分正文，随后停止发送数据。
          controller.enqueue(new TextEncoder().encode('{"data":['));
          requestState.signal?.addEventListener(
            "abort",
            () => {
              controller.error(requestState.signal?.reason);
            },
            { once: true },
          );
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    });
    const service = new CodexProviderConnectionService(client, {
      fetch: fetchMock,
      modelRequestTimeoutMs: 50,
    });
    const requestResult = service.configureCustom({ baseUrl: "https://api.example.com/v1" }).then(
      () => ({ status: "resolved" as const }),
      (error: unknown) => ({ error, status: "rejected" as const }),
    );

    try {
      await vi.advanceTimersByTimeAsync(50);
      expect(requestState.signal?.aborted).toBe(true);
      const result = await requestResult;
      expect(result.status).toBe("rejected");
      if (result.status !== "rejected" || !(result.error instanceof Error)) {
        throw new Error("Expected the custom model request to reject with an error");
      }
      expect(result.error.message).toBe("Custom model request timed out");
      expect(client.requests).toEqual([]);
    } finally {
      // 断言失败时也主动结束开放流，避免测试进程悬挂。
      if (!requestState.signal?.aborted) {
        requestState.streamController?.error(new Error("test cleanup"));
      }
      await requestResult;
      vi.useRealTimers();
    }
  });

  it("rejects a streamed model response whose accumulated body exceeds the byte limit", async () => {
    const client = new FakeRpcClient();
    const encoder = new TextEncoder();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            // 每个分块都低于上限，但累计字节数必须受同一上限约束。
            controller.enqueue(encoder.encode('{"data":['));
            controller.enqueue(encoder.encode('{"id":"model"}'));
            controller.enqueue(encoder.encode("]}"));
            controller.close();
          },
        }),
        { status: 200 },
      ),
    );
    const service = new CodexProviderConnectionService(client, {
      fetch: fetchMock,
      modelResponseMaxBytes: 20,
    });

    await expect(
      service.configureCustom({ baseUrl: "https://api.example.com/v1" }),
    ).rejects.toThrow("Custom model response exceeded the size limit");
    expect(client.requests).toEqual([]);
  });

  it("rejects redirects without exposing the API key", async () => {
    const client = new FakeRpcClient();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(null, { headers: { location: "https://other.test" }, status: 302 }),
      );
    const service = new CodexProviderConnectionService(client, { fetch: fetchMock });

    const error = await service
      .configureCustom({ apiKey: "never-expose-this", baseUrl: "https://api.example.com/v1" })
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("redirect");
    expect((error as Error).message).not.toContain("never-expose-this");
    expect(client.requests).toEqual([]);
  });
});
