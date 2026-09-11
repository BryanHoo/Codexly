import { describe, expect, it, vi } from "vitest";
import { createCodexlyServer } from "./app.js";
import { closeCallbacks, createProvider, createServerOptions } from "./app-all.test-support.js";

describe("personalization routes", () => {
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
