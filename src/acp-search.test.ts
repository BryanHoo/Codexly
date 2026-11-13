import { expect, it, vi } from "vitest";
import { join } from "node:path";
import {
  AcpApplicationRuntime,
  AcpHistory,
  AcpHost,
  type AcpAgentLauncher,
} from "@codexly/provider-acp";
import { Writable } from "node:stream";
import type { CatalogOperations } from "@codexly/core";
import {
  createPersistentAgentPeer,
  startConfiguredAcpTurn,
} from "../packages/provider-acp/test/persistent-agent.test-support.js";
import {
  createWorkspace,
  openRepository,
} from "../packages/server/src/sqlite-state-repository.test-support.js";

it("共享 ACP 搜索分页匹配可见正文并返回精确回合锚点，不启动已缓存任务的 agent", async () => {
  const root = await createWorkspace();
  const store = await openRepository(root);
  await store.catalog("task.put", {
    id: "task",
    provider: "claude",
    projectId: null,
    sessionId: "native",
    cwd: root,
    title: "旧标题",
    updatedAt: 0,
    status: "idle",
    archived: false,
    pinned: true,
  });
  const history = new AcpHistory(join(root, "history"));
  await history.replace(
    "task",
    Array.from({ length: 65 }, (_, i) => ({
      id: `turn-${String(i)}`,
      status: "completed" as const,
      startedAt: null,
      completedAt: null,
      error: null,
      items: [
        {
          id: `message-${String(i)}`,
          type: "message" as const,
          role: "assistant" as const,
          text: `中文 😀 NEEDLE needle ${String(i)}`,
        },
        {
          id: `thought-${String(i)}`,
          type: "reasoning" as const,
          content: "secret",
          summary: "secret",
        },
      ],
    })),
  );
  const launch = vi.fn(() => Promise.reject(new Error("缓存搜索不启动智能体")));
  const runtime = new AcpApplicationRuntime(root, store, () => Promise.resolve(undefined), launch);
  try {
    const search = runtime.search;
    expect(search).toBeDefined();
    let cursor: string | undefined;
    const ids: string[] = [];
    do {
      const page = await search.searchTaskOccurrences(
        "task",
        { query: "needle", ...(cursor ? { cursor } : {}) },
        { id: "temporary", kind: "temporary" },
      );
      expect(page.data.length).toBeLessThanOrEqual(30);
      for (const hit of page.data) {
        const context = await history.read("task", hit.turnCursor);
        expect(
          context.turns.some(
            (turn) => turn.id === hit.turnId && turn.items.some((item) => item.id === hit.itemId),
          ),
        ).toBe(true);
        expect(
          hit.snippet.slice(hit.snippetMatchRange.start, hit.snippetMatchRange.end).toLowerCase(),
        ).toBe("needle");
        ids.push(hit.itemId);
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(ids).toHaveLength(130);
    expect(new Set(ids).size).toBe(65);
    expect(
      (
        await search.searchTaskOccurrences(
          "task",
          { query: "secret" },
          { id: "temporary", kind: "temporary" },
        )
      ).data,
    ).toEqual([]);
    await expect(
      search.searchTaskOccurrences("task", { query: "needle" }, { id: "other", kind: "project" }),
    ).rejects.toThrow("project");
    const first = await search.searchTaskOccurrences(
      "task",
      { query: "needle" },
      { id: "temporary", kind: "temporary" },
    );
    if (!first.nextCursor) throw new Error("未生成搜索游标");
    await expect(
      search.searchTaskOccurrences(
        "task",
        { query: "different", cursor: first.nextCursor },
        { id: "temporary", kind: "temporary" },
      ),
    ).rejects.toThrow("游标");
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      search.searchTaskOccurrences(
        "task",
        { query: "needle" },
        { id: "temporary", kind: "temporary" },
        cancelled.signal,
      ),
    ).rejects.toThrow();
    expect(launch).not.toHaveBeenCalled();
  } finally {
    await runtime.close();
  }
});

it.each(["codex", "claude"] as const)(
  "%s 冷历史搜索使用原会话重放并关闭搜索连接",
  async (engine) => {
    const root = await createWorkspace(),
      store = await openRepository(root);
    const peer = createPersistentAgentPeer();
    peer.transcripts.set("old", [
      { user: true, text: "旧问题" },
      { user: false, text: "中文检索命中" },
    ]);
    await store.catalog("task.put", {
      id: "old-task",
      provider: engine,
      projectId: null,
      sessionId: "old",
      cwd: root,
      title: "历史",
      updatedAt: 0,
      status: "idle",
      archived: false,
      pinned: false,
    });
    const runtime = new AcpApplicationRuntime(
      root,
      store,
      () => Promise.resolve(undefined),
      peer.launch,
    );
    try {
      const result = await runtime.search.searchTaskOccurrences(
        "old-task",
        { query: "检索" },
        { id: "temporary", kind: "temporary" },
      );
      expect(result.data).toHaveLength(1);
      expect(peer.loaded).toEqual(["old"]);
      expect(peer.prompts).toEqual([]);
      expect((await store.catalog("task.read", { id: "old-task" }))?.sessionId).toBe("old");
    } finally {
      await runtime.close();
    }
  },
);

it("桌面共享宿主搜索保留目录授权、单项预算及取消，拒绝跨项目查询", async () => {
  const root = await createWorkspace(),
    store = await openRepository(root);
  await store.catalog("task.put", {
    id: "task",
    provider: "codex",
    projectId: null,
    sessionId: "old",
    cwd: root,
    title: "历史",
    updatedAt: 0,
    status: "idle",
    archived: false,
    pinned: false,
  });
  await new AcpHistory(join(root, "history")).append("task", {
    id: "turn",
    status: "completed",
    startedAt: null,
    completedAt: null,
    error: null,
    items: [{ id: "message", type: "message", role: "assistant", text: "中文 中文" }],
  });
  const frames: Record<string, unknown>[] = [];
  const output = new Writable({
    write(chunk: Buffer, _encoding, done) {
      const frame = JSON.parse(chunk.toString()) as Record<string, unknown>;
      if (typeof frame["catalogId"] === "number") {
        void store
          .catalog(frame["operation"] as keyof CatalogOperations, frame["payload"] as never)
          .then((result) => {
            host.receive(
              Buffer.from(`${JSON.stringify({ catalogId: frame["catalogId"], result })}\n`),
            );
          });
      } else frames.push(frame);
      done();
    },
  });
  const launch = vi.fn(() => Promise.reject(new Error("不启动模型")));
  const host = new AcpHost(root, output, launch);
  const scope = {
    id: "temporary",
    kind: "temporary",
    rootPath: root,
    runtimeWorkspaceRoots: [root],
  };
  try {
    for (const [id, project, limit] of [
      [1, "temporary", 1],
      [2, "other", 1],
      [3, "temporary", 0],
    ] as const) {
      host.receive(
        Buffer.from(
          `${JSON.stringify({ id, method: "search.occurrences", scope: { ...scope, id: project, kind: project === "temporary" ? "temporary" : "project" }, params: { taskId: "task", input: { query: "中文" }, limit } })}\n`,
        ),
      );
      await vi.waitFor(() => {
        expect(frames.some((frame) => frame["id"] === id)).toBe(true);
      });
    }
    expect(frames.find((frame) => frame["id"] === 1)).toMatchObject({
      result: {
        data: [{ itemId: "message", turnId: "turn" }],
        nextCursor: expect.any(String) as unknown,
      },
    });
    const response = frames.find((frame) => frame["id"] === 1);
    if (!response) throw new Error("宿主未返回搜索结果");
    expect((response["result"] as { data: unknown[] }).data).toHaveLength(1);
    for (const id of [2, 3])
      expect(frames.find((frame) => frame["id"] === id)).toMatchObject({
        error: "ACP_HOST_REQUEST_FAILED",
      });
    expect(launch).not.toHaveBeenCalled();
  } finally {
    await host.close();
    output.destroy();
  }
});

it.each(["cancel", "close"] as const)(
  "冷搜索 %s 在启动等待期间发生时回收迟到连接且不加载或发送",
  async (action) => {
    const root = await createWorkspace(),
      store = await openRepository(root);
    await store.catalog("task.put", {
      id: "task",
      provider: "codex",
      projectId: null,
      sessionId: "old",
      cwd: root,
      title: "历史",
      updatedAt: 0,
      status: "idle",
      archived: false,
      pinned: false,
    });
    const peer = createPersistentAgentPeer(),
      gate = Promise.withResolvers<undefined>();
    const entered = Promise.withResolvers<undefined>();
    const closed = vi.fn();
    const launch: AcpAgentLauncher = async (...args) => {
      entered.resolve(undefined);
      await gate.promise;
      const handle = await peer.launch(...args);
      return {
        ...handle,
        close: async () => {
          closed();
          await handle.close();
        },
      };
    };
    const runtime = new AcpApplicationRuntime(
      root,
      store,
      () => Promise.resolve(undefined),
      launch,
    );
    const controller = new AbortController();
    const result = runtime.search.searchTaskOccurrences(
      "task",
      { query: "中文" },
      { id: "temporary", kind: "temporary" },
      controller.signal,
    );
    const rejected = expect(result).rejects.toThrow();
    try {
      await entered.promise;
      const closing = action === "close" ? runtime.close() : undefined;
      if (action === "cancel") controller.abort();
      gate.resolve(undefined);
      await rejected;
      await closing;
      expect(closed).toHaveBeenCalled();
      expect(peer.loaded).toEqual([]);
      expect(peer.prompts).toEqual([]);
    } finally {
      gate.resolve(undefined);
      await runtime.close();
    }
  },
);

it("首个回合尚未落盘时搜索不建立第二个会话或覆盖在途历史", async () => {
  const root = await createWorkspace(),
    store = await openRepository(root);
  const peer = createPersistentAgentPeer(),
    launch = vi.fn(peer.launch);
  const runtime = new AcpApplicationRuntime(root, store, () => Promise.resolve(undefined), launch);
  const provider = runtime.forTemporary(root),
    task = await provider.startTask({ engine: "claude" });
  await store.catalog("task.patch", { id: task.id, title: "手动标题" });
  const entered = Promise.withResolvers<undefined>(),
    release = Promise.withResolvers<undefined>();
  const catalog = store.catalog.bind(store);
  let paused = false;
  const intercept = vi.spyOn(store, "catalog").mockImplementation(async (operation, payload) => {
    if (
      !paused &&
      operation === "acp.storage.claim" &&
      payload &&
      typeof payload === "object" &&
      "key" in payload &&
      payload.key.startsWith("history:")
    ) {
      paused = true;
      entered.resolve(undefined);
      await release.promise;
    }
    return catalog(operation, payload);
  });
  try {
    await startConfiguredAcpTurn(provider, task.id, {
      text: "待落盘的问题",
      files: [],
      images: [],
      skills: [],
      textAttachments: [],
    });
    await entered.promise;
    const found = await runtime.search.searchTaskOccurrences(
      task.id,
      { query: "问题" },
      { id: "temporary", kind: "temporary" },
    );
    expect(found).toEqual({ data: [], nextCursor: null });
    expect(launch).toHaveBeenCalledOnce();
  } finally {
    release.resolve(undefined);
    await runtime.close();
    intercept.mockRestore();
  }
});
