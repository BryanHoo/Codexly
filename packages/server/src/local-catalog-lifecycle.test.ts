import { expect, it, vi } from "vitest";
import { createLocalCatalogClient } from "../../provider-codex/src/local-catalog-client.js";
import { RpcResponseError } from "../../provider-codex/src/jsonl-rpc-errors.js";
import { startCodexAppServer } from "../../provider-codex/src/app-server-process.js";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

async function setup(sessionId: string | null = "native", archived = false) {
  const store = await openRepository(await createWorkspace());
  await store.catalog("task.put", {
    id: "task-local",
    projectId: null,
    title: "任务",
    cwd: "/work",
    provider: "codex",
    sessionId,
    updatedAt: 100,
    pinned: false,
    archived,
    status: "idle",
  });
  const request = vi
    .fn<(method: string, params?: unknown) => Promise<unknown>>()
    .mockResolvedValue({ thread: { id: "native" } });
  const client = await createLocalCatalogClient(
    {
      request,
      notify: vi.fn(),
      onNotification: vi.fn(() => () => undefined),
      onServerRequest: vi.fn(() => () => undefined),
      rejectServerRequest: vi.fn(),
      respondToServerRequest: vi.fn(),
    },
    store,
  );
  return { store, request, client, read: () => store.catalog("task.read", { id: "task-local" }) };
}

const methods = ["thread/archive", "thread/unarchive", "thread/delete"] as const;

it.each(methods)("%s commits local state only after native completion", async (method) => {
  const h = await setup("native", method === "thread/unarchive");
  const before = await h.read();
  let complete!: (value: unknown) => void;
  h.request.mockImplementationOnce(async (_method, params) => {
    expect(params).toEqual({ threadId: "native" });
    expect(await h.read()).toEqual(before);
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  const operation = h.client.request(method, { threadId: "task-local" });
  await vi.waitFor(() => {
    expect(complete).toBeTypeOf("function");
  });
  expect(await h.read()).toEqual(before);
  complete({ thread: { id: "native" } });
  await operation;
  expect(h.request).toHaveBeenCalledWith(method, { threadId: "native" }, undefined, undefined);
  if (method === "thread/delete") expect(await h.read()).toBeNull();
  else expect((await h.read())?.archived).toBe(method === "thread/archive");
});

it.each(methods)("%s preserves local state on upstream failure", async (method) => {
  const h = await setup("native", method === "thread/unarchive");
  const before = await h.read();
  h.request.mockRejectedValue(
    new RpcResponseError({ code: -32600, message: "permission denied", data: null }),
  );
  await expect(h.client.request(method, { threadId: "task-local" })).rejects.toThrow(
    "permission denied",
  );
  expect(await h.read()).toEqual(before);
});

it.each(methods)("%s falls back only when the method is unsupported", async (method) => {
  const h = await setup("native", method === "thread/unarchive");
  h.request.mockRejectedValue(
    new RpcResponseError({ code: -32601, message: "Method not found", data: null }),
  );
  await h.client.request(method, { threadId: "task-local" });
  expect(h.request).toHaveBeenCalledWith(method, { threadId: "native" }, undefined, undefined);
  if (method === "thread/delete") expect(await h.read()).toBeNull();
  else expect((await h.read())?.archived).toBe(method === "thread/archive");
});

it.each(methods)("%s keeps unbound tasks local", async (method) => {
  const h = await setup(null, method === "thread/unarchive");
  await h.client.request(method, { threadId: "task-local" });
  expect(h.request).not.toHaveBeenCalled();
});

it.each(["thread not found: native", "no rollout found for thread id native"])(
  "finishes local deletion for exact native absence: %s",
  async (message) => {
    const h = await setup();
    h.request.mockRejectedValue(new RpcResponseError({ code: -32600, message, data: null }));
    await h.client.request("thread/delete", { threadId: "task-local" });
    expect(await h.read()).toBeNull();
  },
);

it("restores legacy local archives after confirming the native thread still exists", async () => {
  const h = await setup("native", true);
  h.request.mockRejectedValueOnce(
    new RpcResponseError({
      code: -32600,
      message: "no archived rollout found for thread id native",
      data: null,
    }),
  );
  await h.client.request("thread/unarchive", { threadId: "task-local" });
  expect(h.request).toHaveBeenLastCalledWith(
    "thread/read",
    { threadId: "native", includeTurns: false },
    undefined,
    undefined,
  );
  expect((await h.read())?.archived).toBe(false);
});

it("preserves a legacy archive if its native thread cannot be verified", async () => {
  const h = await setup("native", true);
  h.request.mockRejectedValueOnce(
    new RpcResponseError({
      code: -32600,
      message: "no archived rollout found for thread id native",
      data: null,
    }),
  );
  h.request.mockRejectedValueOnce(new Error("read failed"));
  await expect(h.client.request("thread/unarchive", { threadId: "task-local" })).rejects.toThrow(
    "read failed",
  );
  expect((await h.read())?.archived).toBe(true);
});

// 真实固定版本 App Server：只管理临时目录内的新会话，不调用模型或读取用户历史。
it.runIf(process.env["CODEXLY_REAL_RUNTIME_TEST"] === "1")(
  "archives, restores and deletes native Codex history through the local adapter",
  async () => {
    const root = await createWorkspace();
    const store = await openRepository(root);
    const runtime = await startCodexAppServer({
      cwd: root,
      env: { ...process.env, CODEX_HOME: root },
    });
    try {
      const native = (await runtime.client.request("thread/start", {
        cwd: root,
        historyMode: "paginated",
      })) as { thread: { id: string } };
      const sessionId = native.thread.id;
      await store.catalog("task.put", {
        id: "task-real",
        projectId: null,
        title: "真实回归",
        cwd: root,
        provider: "codex",
        sessionId,
        updatedAt: 100,
        pinned: false,
        archived: false,
        status: "idle",
      });
      const client = await createLocalCatalogClient(runtime.client, store);
      await client.request("thread/archive", { threadId: "task-real" });
      const archived = (await runtime.client.request("thread/list", { archived: true })) as {
        data: { id: string }[];
      };
      expect(archived.data.some((task) => task.id === sessionId)).toBe(true);
      await client.request("thread/unarchive", { threadId: "task-real" });
      const restored = (await runtime.client.request("thread/read", {
        threadId: sessionId,
        includeTurns: false,
      })) as {
        thread: { id: string };
      };
      expect(restored.thread.id).toBe(sessionId);
      // 原生活动列表会过滤从未发送用户消息的空会话；用存在性和归档列表共同核实恢复。
      const remaining = (await runtime.client.request("thread/list", { archived: true })) as {
        data: { id: string }[];
      };
      expect(remaining.data.some((task) => task.id === sessionId)).toBe(false);
      // 模拟升级前只在应用归档、原生仍活动的历史任务。
      await store.catalog("task.patch", { id: "task-real", archived: true });
      await client.request("thread/unarchive", { threadId: "task-real" });
      expect((await store.catalog("task.read", { id: "task-real" }))?.archived).toBe(false);
      await client.request("thread/archive", { threadId: "task-real" });
      await client.request("thread/delete", { threadId: "task-real" });
      expect(await store.catalog("task.read", { id: "task-real" })).toBeNull();
      await expect(
        runtime.client.request("thread/read", { threadId: sessionId, includeTurns: false }),
      ).rejects.toThrow();
      // 模拟原生删除已完成但本地提交失败，重试必须只完成剩余清理。
      await expect(
        runtime.client.request("thread/delete", { threadId: sessionId }),
      ).rejects.toMatchObject({
        code: -32600,
        message: `no rollout found for thread id ${sessionId}`,
      });
      await store.catalog("task.put", {
        id: "task-retry",
        projectId: null,
        title: "删除重试",
        cwd: root,
        provider: "codex",
        sessionId,
        updatedAt: 100,
        pinned: false,
        archived: true,
        status: "idle",
      });
      await client.request("thread/delete", { threadId: "task-retry" });
      expect(await store.catalog("task.read", { id: "task-retry" })).toBeNull();
    } finally {
      await runtime.close();
    }
  },
  30000,
);
