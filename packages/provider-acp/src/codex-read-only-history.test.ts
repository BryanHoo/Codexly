import { expect, it, vi, beforeEach } from "vitest";
const { request, close, start } = vi.hoisted(() => {
  const request = vi.fn<(method: string, ...args: unknown[]) => Promise<unknown>>();
  const close = vi.fn(() => Promise.resolve());
  return { request, close, start: vi.fn(() => Promise.resolve({ client: { request }, close })) };
});
vi.mock("../../provider-codex/src/app-server-process.js", () => ({ startCodexAppServer: start }));
import { readCodexReadOnlyHistory } from "../../provider-codex/src/read-only-history.js";
beforeEach(() => {
  vi.clearAllMocks();
});
it("只发读取请求并释放进程，不恢复或启动会话", async () => {
  request.mockImplementation((method) =>
    Promise.resolve(
      method === "thread/read"
        ? { thread: { id: "native", historyMode: "legacy" } }
        : { data: [], nextCursor: null, backwardsCursor: null },
    ),
  );
  expect((await readCodexReadOnlyHistory("native", "/tmp")).turns).toEqual([]);
  expect(request.mock.calls.map((args) => args[0])).toEqual(["thread/read", "thread/turns/list"]);
  expect(close).toHaveBeenCalledOnce();
});
it("读取失败也回收临时进程", async () => {
  const failure = new Error("read failed");
  request.mockRejectedValue(failure);
  await expect(readCodexReadOnlyHistory("native", "/tmp")).rejects.toBe(failure);
  expect(close).toHaveBeenCalledOnce();
});
