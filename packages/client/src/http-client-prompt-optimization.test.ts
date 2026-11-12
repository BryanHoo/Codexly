import { expect, it, vi } from "vitest";
import { CodexlyClient } from "./http-client.js";

it("输入优化将用户取消与既有请求预算合并并传给 fetch", async () => {
  let received: AbortSignal | undefined;
  let release!: () => void;
  const fetch = vi.fn<typeof globalThis.fetch>(
    (_url, options) =>
      new Promise((resolve, reject) => {
        received = options?.signal ?? undefined;
        release = () => {
          resolve(new Response('{"text":"结果"}'));
        };
        received?.addEventListener(
          "abort",
          () => {
            reject(controller.signal.reason as Error);
          },
          { once: true },
        );
      }),
  );
  const client = new CodexlyClient({ fetch, baseUrl: "http://localhost:3210" });
  const controller = new AbortController();
  const pending = client.optimizePrompt("p", "input", { signal: controller.signal });
  const outcome = pending.catch((error: unknown) => error);
  try {
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce();
    });
    controller.abort();
    expect(received?.aborted).toBe(true);
    expect(await outcome).toBe(controller.signal.reason);
  } finally {
    release();
    await outcome;
  }
});

it("fetch 忽略取消后才返回的响应不得交付给草稿", async () => {
  const response = Promise.withResolvers<Response>();
  const fetch = vi.fn<typeof globalThis.fetch>(() => response.promise);
  const client = new CodexlyClient({ fetch });
  const controller = new AbortController();
  const pending = client.optimizePrompt("p", "input", { signal: controller.signal });
  controller.abort();
  response.resolve(new Response('{"text":"旧结果"}'));
  await expect(pending).rejects.toBe(controller.signal.reason);
});

it("读取响应正文期间取消同样拒绝迟到内容", async () => {
  const response = new Response();
  const body = Promise.withResolvers<unknown>();
  const read = vi.spyOn(response, "json").mockReturnValue(body.promise);
  const client = new CodexlyClient({
    fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(response),
  });
  const controller = new AbortController();
  const pending = client.optimizePrompt("p", "input", { signal: controller.signal });
  await vi.waitFor(() => {
    expect(read).toHaveBeenCalledOnce();
  });
  controller.abort();
  body.resolve({ text: "旧结果" });
  await expect(pending).rejects.toBe(controller.signal.reason);
});
