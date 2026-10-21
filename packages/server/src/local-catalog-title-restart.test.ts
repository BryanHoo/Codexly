import { expect, it, vi } from "vitest";
import { createLocalCatalogClient } from "../../provider-codex/src/local-catalog-client.js";
import { CodexTaskTitles } from "../../provider-codex/src/task-titles.js";
import { localTaskMetadata } from "../../core/src/engine-router.js";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

it.each(["success", "failure", "cancel"] as const)(
  "restores a title from the catalog alone after automatic generation %s",
  async (outcome) => {
    const root = await createWorkspace();
    const store = await openRepository(root);
    await store.catalog("task.put", {
      id: "task-restart",
      projectId: null,
      title: "",
      provider: "codex",
      sessionId: null,
      cwd: root,
      updatedAt: 100,
      pinned: true,
      archived: false,
      status: "idle",
    });
    await store.catalog("task.preview", { id: "task-restart", preview: "首条请求预览" });
    const raw = {
      request: vi.fn(() => Promise.reject(new Error("Offline catalog must not contact Codex"))),
      notify: vi.fn(),
      onNotification: vi.fn(() => () => undefined),
      onServerRequest: vi.fn(() => () => undefined),
      rejectServerRequest: vi.fn(),
      respondToServerRequest: vi.fn(),
    };
    const client = await createLocalCatalogClient(raw, store);
    const titles = new CodexTaskTitles(client, () => Promise.resolve("model"), { warn: vi.fn() });
    let resolve!: (title: string) => void;
    let reject!: (error: Error) => void;
    titles.generate = vi.fn(
      () =>
        new Promise<string>((yes, no) => {
          resolve = yes;
          reject = no;
        }),
    );
    titles.register(
      "task-restart",
      { kind: "temporary", id: "temporary", rootPath: root, runtimeWorkspaceRoots: [] },
      root,
    );
    titles.start("task-restart", {
      text: "首条请求预览",
      files: [],
      skills: [],
      images: [],
      textAttachments: [],
    });
    await vi.waitFor(() => {
      expect(titles.generate).toHaveBeenCalledOnce();
    });
    const notification = vi.fn();
    client.onNotification(notification);
    if (outcome === "success") {
      resolve("自动生成标题");
      await vi.waitFor(() => {
        expect(notification).toHaveBeenCalledWith({
          method: "thread/name/updated",
          params: { threadId: "task-restart", threadName: "自动生成标题" },
        });
      });
    } else if (outcome === "failure") {
      reject(new Error("Model unavailable"));
    } else {
      // 模拟应用退出时取消生成；即便辅助模型迟到返回，也只能保留已落盘预览。
      const released = titles.releaseProject("temporary");
      resolve("迟到标题");
      await released;
    }
    await titles.releaseProject("temporary");
    await store.close();
    const reopened = await openRepository(root);
    const page = await reopened.catalog("task.list", { projectId: null, pinned: true });
    const loaded = page.data[0];
    expect(loaded && localTaskMetadata(loaded).title).toBe(
      outcome === "success" ? "自动生成标题" : "首条请求预览",
    );
    expect(raw.request).not.toHaveBeenCalled();
  },
);
