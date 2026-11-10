import * as acp from "@agentclientprotocol/sdk/unstable";
import { expect, it, vi } from "vitest";
import type { LocalCatalogStore, LocalTask, CatalogOperations } from "@codexly/core";
import { AcpConnection } from "./connection.js";
import { importAcpCatalog } from "./catalog-import.js";
import { AcpRuntime, type AcpAgentLauncher } from "./runtime.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function fixture() {
  const tasks = new Map<string, LocalTask>();
  tasks.set("old-id", {
    id: "old-id",
    projectId: "project",
    provider: "codex",
    sessionId: "native",
    cwd: "/project",
    title: "用户重命名",
    pinned: true,
    archived: true,
    status: "idle",
    updatedAt: 50,
  });
  const store: LocalCatalogStore = {
    catalog: <K extends keyof CatalogOperations>(
      operation: K,
      payload: CatalogOperations[K][0],
    ) => {
      let result: unknown;
      if (operation === "task.bindings") result = [...tasks.values()];
      else if (operation === "project.list")
        result = [{ id: "project", path: "/project", name: "项目", createdAt: "2026-01-01" }];
      else if (operation === "task.put") {
        const task = payload as LocalTask;
        if (!tasks.has(task.id)) tasks.set(task.id, task);
        result = tasks.get(task.id);
      } else throw new Error(operation);
      return Promise.resolve(result as CatalogOperations[K][1]);
    },
  };
  const a = new TransformStream<acp.AnyMessage, acp.AnyMessage>(),
    b = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
  const list = vi.fn(
    ({ params }: acp.AgentRequestContext<acp.ListSessionsRequest>): acp.ListSessionsResponse =>
      params.cursor
        ? {
            sessions: [
              {
                sessionId: "new",
                cwd: "/other",
                title: "新任务",
                updatedAt: "2026-01-02T00:00:00Z",
              },
            ],
          }
        : {
            sessions: [{ sessionId: "native", cwd: "/project", title: "agent 标题" }],
            nextCursor: "page-2",
          },
  );
  const peer = acp
    .agent({ name: "test" })
    .onRequest(acp.methods.agent.initialize, () => ({
      protocolVersion: 1,
      agentCapabilities: { sessionCapabilities: { list: {} } },
    }))
    .onRequest(acp.methods.agent.session.list, list)
    .connect({ readable: a.readable, writable: b.writable });
  const connection = await AcpConnection.connect({ readable: b.readable, writable: a.writable });
  return {
    tasks,
    store,
    list,
    connection,
    close() {
      connection.close();
      peer.close();
    },
  };
}
it("分页发现历史保持既有身份和管理状态，重复导入不创建重复任务且两引擎分离", async () => {
  const f = await fixture();
  try {
    const old = structuredClone(f.tasks.get("old-id"));
    await importAcpCatalog("codex", f.connection, f.store);
    expect(f.tasks.get("old-id")).toEqual(old);
    expect(f.tasks.size).toBe(2);
    const added = [...f.tasks.values()].find((task) => task.sessionId === "new");
    expect(added).toMatchObject({ projectId: null, provider: "codex", cwd: "/other" });
    await importAcpCatalog("codex", f.connection, f.store);
    expect(f.tasks.size).toBe(2);
    await importAcpCatalog("claude", f.connection, f.store);
    expect(f.tasks.size).toBe(4);
    expect(
      [...f.tasks.values()].find(
        (task) => task.provider === "claude" && task.sessionId === "native",
      )?.projectId,
    ).toBe("project");
  } finally {
    f.close();
  }
});
it("分页循环、异常与取消不删除已有绑定，允许从头安全重试", async () => {
  const f = await fixture();
  try {
    f.list.mockReturnValue({ sessions: [], nextCursor: "cycle" });
    await expect(importAcpCatalog("codex", f.connection, f.store)).rejects.toThrow("分页");
    expect(f.tasks.size).toBe(1);
    f.list.mockImplementationOnce(() => {
      throw acp.RequestError.authRequired();
    });
    await expect(importAcpCatalog("codex", f.connection, f.store)).rejects.toMatchObject({
      code: -32000,
    });
    expect(f.tasks.size).toBe(1);
    f.list.mockClear();
    const controller = new AbortController();
    controller.abort();
    await expect(
      importAcpCatalog("codex", f.connection, f.store, controller.signal),
    ).rejects.toThrow();
    expect(f.list).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});
it("运行时目录发现只启动指定引擎，预先取消不启动任何 agent", async () => {
  const f = await fixture();
  const root = await mkdtemp(join(tmpdir(), "acp-catalog-"));
  const launch = vi.fn<AcpAgentLauncher>(() =>
    Promise.resolve({
      connection: f.connection,
      close: () => {
        f.close();
        return Promise.resolve();
      },
    }),
  );
  const runtime = new AcpRuntime(root, f.store, launch);
  try {
    const controller = new AbortController();
    controller.abort();
    await expect(runtime.importCatalog("claude", controller.signal)).rejects.toThrow();
    expect(launch).not.toHaveBeenCalled();
    await runtime.importCatalog("claude");
    expect(launch).toHaveBeenCalledOnce();
    expect(launch.mock.calls[0]?.[0]).toBe("claude");
    expect(f.tasks.size).toBe(3);
  } finally {
    await runtime.close();
    f.close();
    await rm(root, { recursive: true, force: true });
  }
});
