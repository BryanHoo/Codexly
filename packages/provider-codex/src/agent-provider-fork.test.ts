import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCodexRuntimeProvider } from "./agent-provider.js";
import {
  FakeRpcClient,
  createCodexAgentProvider,
  nativeThread,
  project,
} from "./agent-provider.test-support.js";

describe("CodexAgentProvider fork visibility", () => {
  it("restores an untouched fork after the provider restarts", async ({ onTestFinished }) => {
    const codexHome = await mkdtemp(join(tmpdir(), "codexly-fork-"));
    onTestFinished(() => rm(codexHome, { recursive: true, force: true }));
    const source = nativeThread();
    const fork = nativeThread({ id: "task-fork", projectId: null });
    const assignedFork = { ...fork, projectId: project.id };
    const rpc = new FakeRpcClient([
      { data: [source], nextCursor: null },
      { thread: fork },
      { thread: assignedFork },
      { data: [], nextCursor: null },
      { thread: assignedFork },
      {},
      { data: [], nextCursor: null },
      { thread: { ...assignedFork, path: "/codex/archived_sessions/fork.jsonl" } },
      { data: [], nextCursor: null },
      { thread: assignedFork },
    ]);
    const first = createCodexRuntimeProvider({ client: rpc, codexHome }).forProject(project);
    await first.listTasks();
    await first.forkTask("task-1");

    const restarted = createCodexRuntimeProvider({ client: rpc, codexHome }).forProject(project);
    await expect(restarted.listTasks()).resolves.toMatchObject({
      data: [{ id: "task-fork", projectId: project.id }],
    });
    await expect(restarted.renameTask("task-fork", "重启后的分支")).resolves.toBeUndefined();
    expect(rpc.calls.at(-1)).toEqual({
      method: "thread/name/set",
      params: { name: "重启后的分支", threadId: "task-fork" },
    });
    await expect(restarted.listTasks()).resolves.toEqual({ data: [], nextCursor: null });
    await expect(restarted.listTasks()).resolves.toMatchObject({ data: [{ id: "task-fork" }] });
  });

  it("assigns a persisted fork to its source project before exposing it", async () => {
    const source = nativeThread();
    const fork = nativeThread({ id: "task-fork", projectId: null });
    const assignedFork = { ...fork, projectId: project.id };
    const rpc = new FakeRpcClient([
      { data: [source], nextCursor: null },
      { thread: fork },
      { thread: assignedFork },
      { data: [assignedFork, source], nextCursor: null },
      {},
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.listTasks();

    await expect(provider.forkTask("task-1")).resolves.toMatchObject({
      id: "task-fork",
      projectId: project.id,
    });
    await expect(provider.listTasks()).resolves.toMatchObject({
      data: [{ id: "task-fork" }, { id: "task-1" }],
    });
    await expect(provider.renameTask("task-fork", "分支新名称")).resolves.toBeUndefined();
    expect(rpc.calls.slice(1, 3)).toEqual([
      expect.objectContaining({ method: "thread/fork" }),
      {
        method: "thread/metadata/update",
        params: { projectId: project.id, threadId: "task-fork" },
      },
    ]);
    expect(rpc.calls.at(-1)).toEqual({
      method: "thread/name/set",
      params: { name: "分支新名称", threadId: "task-fork" },
    });
  });

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
