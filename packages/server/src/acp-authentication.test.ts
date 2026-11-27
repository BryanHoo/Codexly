import { expect, it, vi } from "vitest";
import { createCodexlyServer } from "./app.js";
import { closeCallbacks, createProvider, createServerOptions } from "./app-all.test-support.js";

const attemptId = "1887581d-2014-474d-9ee9-eb19e74e95d7";

async function authenticationFixture() {
  const started = Promise.withResolvers<AbortSignal>();
  const authorized = Promise.withResolvers<undefined>();
  const authenticate = vi.fn(async (_methodId: string, signal?: AbortSignal) => {
    if (!signal) throw new Error("认证缺少取消信号");
    started.resolve(signal);
    await authorized.promise;
    signal.throwIfAborted();
    return {};
  });
  const service = {
    inspect: vi.fn(),
    readDefaults: vi.fn(),
    updateDefaults: vi.fn(),
    setDefaultConfig: vi.fn(),
    authenticate,
    authElicitation: () => {
      authorized.resolve(undefined);
      return [];
    },
  };
  const app = await createCodexlyServer({
    ...createServerOptions(createProvider().provider),
    acpAgents: { codex: service, claude: service, "acp-codefree-o": service },
  });
  closeCallbacks.push(() => app.close());
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const url = `${address}/v1/acp/agents/acp-codefree-o/authenticate`;
  return { authenticate, started: started.promise, authorized, url };
}

it.each(["callback", "disconnect"] as const)(
  "真实 HTTP 登录读取完正文后只响应授权或客户端断连，场景 %s",
  async (scenario) => {
    const fixture = await authenticationFixture();
    const controller = new AbortController();
    const response = fetch(fixture.url, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": attemptId },
      body: JSON.stringify({ methodId: "codefree-browser", attemptId }),
      signal: controller.signal,
    });
    void response.catch(() => undefined);
    try {
      const signal = await fixture.started;
      // 等待正文 close 派发，只有真实 HTTP 连接会触发 Fastify 的提前取消。
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(signal.aborted).toBe(false);
      if (scenario === "disconnect") {
        controller.abort();
        await expect(response).rejects.toMatchObject({ name: "AbortError" });
        await vi.waitFor(() => {
          expect(signal.aborted).toBe(true);
        });
        return;
      }
      const callback = await fetch(`${fixture.url}/elicitation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          attemptId,
          requestId: "callback",
          resolution: { action: "accept", content: { code: "fixture" } },
        }),
      });
      expect(await callback.json()).toEqual([]);
      const result = await response;
      expect(result.status, await result.text()).toBe(200);
      expect(fixture.authenticate).toHaveBeenCalledExactlyOnceWith(
        "codefree-browser",
        signal,
        undefined,
        attemptId,
      );
    } finally {
      fixture.authorized.resolve(undefined);
      await response.catch(() => undefined);
    }
  },
);
