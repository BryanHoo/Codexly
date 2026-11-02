import { describe, expect, it } from "vitest";
import { RpcResponseError } from "./jsonl-rpc-client.js";
import {
  FakeRpcClient,
  project,
  createCodexAgentProvider,
  nativeThread,
} from "./agent-provider.test-support.js";

describe("会话实际记忆摘要", () => {
  it.each(["# 项目记忆\n使用中文", null])("保留摘要或正常空值 %s", async (summary) => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }, { summary }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.listTasks();
    await expect(provider.readThreadMemory("task-1")).resolves.toEqual({
      status: "ready",
      summary,
    });
    expect(rpc.calls.at(-1)).toEqual({
      method: "thread/memory/read",
      params: { threadId: "task-1" },
    });
    expect(rpc.calls.some((call) => call.method === "thread/resume")).toBe(false);
  });
  it.each([
    [-32600, "thread not found: task-1", "not_loaded"],
    [-32601, "Method not found", "unsupported"],
  ])("区分未加载与旧版本 %s", async (code, message, status) => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.listTasks();
    rpc.request = () => Promise.reject(new RpcResponseError({ code, message, data: null }));
    await expect(provider.readThreadMemory("task-1")).resolves.toEqual({ status, summary: null });
  });
  it("拒绝无效响应且不吞掉真实错误", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }, {}]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.listTasks();
    await expect(provider.readThreadMemory("task-1")).rejects.toThrow();
    const error = new RpcResponseError({ code: -32603, message: "disk failure", data: null });
    rpc.request = () => Promise.reject(error);
    await expect(provider.readThreadMemory("task-1")).rejects.toBe(error);
  });
});
