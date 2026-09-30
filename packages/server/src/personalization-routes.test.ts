import { describe, expect, it, vi } from "vitest";
import { createCodexRuntimeProvider, type CodexRpcClient } from "@codexly/provider-codex";
import { createCodexlyServer } from "./app.js";
import { closeCallbacks, createProvider, createServerOptions } from "./app-all.test-support.js";

describe("personalization routes", () => {
  it.each([null, { memories: true }])(
    "原生配置返回空记忆章节时读取接口返回 200：features=%j",
    async (features) => {
      const request = vi.fn(() => Promise.resolve({ config: { features, memories: null } }));
      const client: CodexRpcClient = {
        request,
        notify: vi.fn(),
        onNotification: () => () => undefined,
        onServerRequest: () => () => undefined,
        rejectServerRequest: () => Promise.resolve(),
        respondToServerRequest: vi.fn(),
      };
      // 只替换 RPC 边界，使用真实 Provider 解析器验证原来的 HTTP 500 路径。
      const personalization = createCodexRuntimeProvider({ client }).personalization;
      const options = createServerOptions(createProvider().provider);
      const app = await createCodexlyServer({
        ...options,
        provider: { ...options.provider, personalization },
      });
      closeCallbacks.push(() => app.close());
      const response = await app.inject({ method: "GET", url: "/v1/personalization/memories" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ enabled: features !== null, allowExternalContext: true });
      expect(request).toHaveBeenCalledWith("config/read", { includeLayers: false });
    },
  );

  it("校验请求、复用幂等结果，并返回明确的文件冲突", async () => {
    const options = createServerOptions(createProvider().provider);
    const instructions = { content: "original", path: "/runtime/AGENTS.md", overrideActive: false };
    const personalization = {
      getGlobalInstructions: vi.fn(() => Promise.resolve(instructions)),
      saveGlobalInstructions: vi.fn(() => Promise.resolve(instructions)),
      getMemorySettings: vi.fn(() =>
        Promise.resolve({ enabled: false, allowExternalContext: true }),
      ),
      updateMemorySettings: vi.fn(() =>
        Promise.resolve({ enabled: true, allowExternalContext: true }),
      ),
      resetMemories: vi.fn(() => Promise.resolve()),
      getAgentPreferences: vi.fn(() =>
        Promise.resolve({ webSearch: "cached" as const, modelVerbosity: null }),
      ),
      updateAgentPreferences: vi.fn(() =>
        Promise.resolve({ webSearch: "live" as const, modelVerbosity: null }),
      ),
    };
    const app = await createCodexlyServer({
      ...options,
      provider: { ...options.provider, personalization },
    });
    closeCallbacks.push(() => app.close());
    expect(
      (await app.inject({ method: "GET", url: "/v1/personalization/instructions" })).json(),
    ).toEqual(instructions);
    const reset = {
      method: "POST" as const,
      url: "/v1/personalization/memories/reset",
      headers: { "idempotency-key": "reset-once" },
      payload: {},
    };
    expect((await app.inject(reset)).statusCode).toBe(200);
    expect((await app.inject(reset)).statusCode).toBe(200);
    expect(personalization.resetMemories).toHaveBeenCalledOnce();
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/v1/personalization/memories",
          headers: { "idempotency-key": "invalid" },
          payload: { enabled: "yes" },
        })
      ).statusCode,
    ).toBe(400);
    personalization.saveGlobalInstructions.mockRejectedValueOnce(
      Object.assign(new Error("changed"), { code: "GLOBAL_INSTRUCTIONS_CHANGED" }),
    );
    const conflict = await app.inject({
      method: "PUT",
      url: "/v1/personalization/instructions",
      headers: { "idempotency-key": "conflict" },
      payload: { content: "new", expectedContent: "old" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: "GLOBAL_INSTRUCTIONS_CHANGED" });
  });
});
