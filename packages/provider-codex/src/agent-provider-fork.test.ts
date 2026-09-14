import { describe, expect, it } from "vitest";
import {
  FakeRpcClient,
  createCodexAgentProvider,
  nativeThread,
  project,
} from "./agent-provider.test-support.js";

describe("CodexAgentProvider fork visibility", () => {
  it("retains an untouched fork across refreshes until the native list includes it", async () => {
    const source = nativeThread();
    const fork = nativeThread({ id: "task-fork", name: "分支任务" });
    const rpc = new FakeRpcClient([
      { data: [source], nextCursor: null },
      { thread: fork },
      { data: [source], nextCursor: null },
      { data: [source], nextCursor: null },
      { data: [{ ...fork, name: "上游更新的标题" }, source], nextCursor: null },
      { data: [source], nextCursor: null },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.listTasks();
    await provider.forkTask("task-1");

    // 不发送消息或执行其他操作，连续刷新仍必须保留已确认创建的分支。
    for (let refresh = 0; refresh < 2; refresh += 1) {
      await expect(provider.listTasks()).resolves.toMatchObject({
        data: [{ id: "task-fork", title: "分支任务" }, { id: "task-1" }],
      });
    }
    await expect(provider.listTasks()).resolves.toMatchObject({
      data: [{ id: "task-fork", title: "上游更新的标题" }, { id: "task-1" }],
    });
    // 上游确认后撤销补偿，后续真实移除不能被旧缓存重新补回。
    await expect(provider.listTasks()).resolves.toMatchObject({ data: [{ id: "task-1" }] });
  });
});
