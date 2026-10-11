import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { finalizeMarkdownInWorker } from "./markdown-finalization.js";
import { createMarkdownBlock } from "@codexly/frontend-core/streaming-markdown-block";

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | undefined;
  onerror: (() => void) | undefined;
  onmessageerror: (() => void) | undefined;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    TestWorker.instances.push(this);
  }
  respond(source: string) {
    this.onmessage?.({ data: { blocks: [createMarkdownBlock(source, source)] } });
  }
}

function getWorker(index: number): TestWorker {
  const worker = TestWorker.instances[index];
  if (worker === undefined) throw new Error("Worker should have been created");
  return worker;
}

beforeEach(() => {
  vi.useFakeTimers();
  TestWorker.instances = [];
  vi.stubGlobal("Worker", TestWorker);
});
afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("串行复用一个 Worker，闲置后释放线程", async () => {
  const first = finalizeMarkdownInWorker("第一段", new AbortController().signal);
  const second = finalizeMarkdownInWorker("第二段", new AbortController().signal);
  const worker = getWorker(0);
  expect(TestWorker.instances).toHaveLength(1);
  expect(worker.postMessage.mock.calls).toEqual([["第一段"]]);
  worker.respond("第一段");
  expect((await first)[0]?.source).toBe("第一段");
  expect(worker.postMessage.mock.calls).toEqual([["第一段"], ["第二段"]]);
  worker.respond("第二段");
  expect((await second)[0]?.source).toBe("第二段");
  vi.advanceTimersByTime(1_000);
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it("取消运行中的解析后立即推进下一段，不等待旧的大块 lexer", async () => {
  const controller = new AbortController();
  const first = finalizeMarkdownInWorker("旧回复", controller.signal);
  const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
  const second = finalizeMarkdownInWorker("新回复", new AbortController().signal);
  const original = getWorker(0);
  controller.abort();
  await rejected;
  expect(original.terminate).toHaveBeenCalledOnce();
  expect(TestWorker.instances).toHaveLength(2);
  const latest = getWorker(1);
  expect(latest.postMessage.mock.calls).toEqual([["新回复"]]);
  original.respond("旧回复");
  original.onerror?.();
  expect(latest.terminate).not.toHaveBeenCalled();
  latest.respond("新回复");
  expect((await second)[0]?.source).toBe("新回复");
});

it("取消排队任务不影响正在运行的解析", async () => {
  const first = finalizeMarkdownInWorker("第一段", new AbortController().signal);
  const controller = new AbortController();
  const second = finalizeMarkdownInWorker("取消的段落", controller.signal);
  const rejected = expect(second).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await rejected;
  const worker = getWorker(0);
  worker.respond("第一段");
  await first;
  expect(worker.postMessage).toHaveBeenCalledOnce();
  expect(worker.terminate).not.toHaveBeenCalled();
});

it("Worker 加载失败时释放线程并拒绝解析，不回退同步 lexer", async () => {
  const result = finalizeMarkdownInWorker("正文", new AbortController().signal);
  const rejected = expect(result).rejects.toThrow("worker failed");
  const worker = getWorker(0);
  worker.onerror?.();
  await rejected;
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it("已取消的请求不创建 Worker", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(finalizeMarkdownInWorker("正文", controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(TestWorker.instances).toHaveLength(0);
});
