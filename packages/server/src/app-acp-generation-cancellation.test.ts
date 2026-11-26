import { expect, it, vi } from "vitest";
import type { ApplicationTextGenerator } from "@codexly/core";
import { createCodexlyServer } from "./app.js";
import {
  closeCallbacks,
  createProvider,
  createServerOptions,
  encodedProjectRootPath,
} from "./app-all.test-support.js";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

it.each([
  [0, "optimize"],
  [60000, "optimize"],
  [0, "commit"],
  [60000, "commit"],
] as const)(
  "真实 HTTP 断连将取消传给 ACP 临时生成，handlerTimeout=%s purpose=%s",
  async (handlerTimeoutMs, purpose) => {
    const store = await openRepository(await createWorkspace());
    const h = createProvider(),
      options = createServerOptions(h.provider);
    const observed = Promise.withResolvers<AbortSignal>();
    const release = Promise.withResolvers<undefined>();
    const generateText = vi.fn<ApplicationTextGenerator>(
      async (_engine, _root, _prompt, _model, signal) => {
        observed.resolve(signal);
        await release.promise;
        signal.throwIfAborted();
        return '{"message":"结果"}';
      },
    );
    const app = await createCodexlyServer({
      ...options,
      localCatalogStore: store,
      handlerTimeoutMs,
      readProjectGitStatus: () =>
        Promise.resolve({
          branch: "main",
          branches: ["main"],
          baseBranches: ["main"],
          repositoryMode: "root",
          snapshot: "a".repeat(64),
          staged: [],
          unstaged: [{ path: "a", kind: "update", diff: "-old\n+new" }],
        }),
      provider: {
        ...options.provider,
        getCapabilities: async () => ({ ...(await h.provider.getCapabilities()), runtime: "acp" }),
        generateText,
      },
    });
    closeCallbacks.push(() => app.close());
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();
    const endpoint =
      purpose === "optimize"
        ? "/v1/projects/codexly/prompt-optimization"
        : `/v1/projects/codexly/git/commit-message?rootPath=${encodedProjectRootPath}`;
    const response = fetch(`${address}${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "cancel-generation" },
      body: JSON.stringify(
        purpose === "optimize"
          ? { text: "input" }
          : { paths: ["a"], expectedSnapshot: "a".repeat(64) },
      ),
      signal: controller.signal,
    }).catch(() => undefined);
    try {
      await vi.waitFor(() => {
        expect(generateText).toHaveBeenCalledOnce();
      });
      const signal = await observed.promise;
      expect(signal.aborted).toBe(false);
      controller.abort();
      await response;
      await vi.waitFor(() => {
        expect(signal.aborted).toBe(true);
      });
      expect(h.startTask).not.toHaveBeenCalled();
      expect(h.listModels).not.toHaveBeenCalled();
    } finally {
      controller.abort();
      release.resolve(undefined);
      await response;
    }
  },
);

it("HTTP 截止时间取消 ACP 生成并等待清理后交付错误", async () => {
  const store = await openRepository(await createWorkspace());
  const h = createProvider(),
    options = createServerOptions(h.provider);
  const observed = Promise.withResolvers<AbortSignal>();
  const release = Promise.withResolvers<undefined>();
  const generateText: ApplicationTextGenerator = async (
    _engine,
    _root,
    _prompt,
    _model,
    signal,
  ) => {
    observed.resolve(signal);
    await release.promise;
    signal.throwIfAborted();
    return '{"message":"结果"}';
  };
  const app = await createCodexlyServer({
    ...options,
    localCatalogStore: store,
    handlerTimeoutMs: 500,
    provider: {
      ...options.provider,
      getCapabilities: async () => ({ ...(await h.provider.getCapabilities()), runtime: "acp" }),
      generateText,
    },
  });
  closeCallbacks.push(() => app.close());
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const response = fetch(`${address}/v1/projects/codexly/prompt-optimization`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "deadline" },
    body: JSON.stringify({ text: "input" }),
  });
  try {
    const signal = await observed.promise;
    await vi.waitFor(
      () => {
        expect(signal.aborted).toBe(true);
      },
      { timeout: 1500 },
    );
    release.resolve(undefined);
    expect((await response).status).toBe(503);
  } finally {
    release.resolve(undefined);
    await response;
  }
});
